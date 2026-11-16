import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedAgent, seedUser } from "../test/helpers";
import { deleteAccount, deletedEmail, DELETED_USER_NAME } from "./account";
import type { Db } from "./db/client";
import { account, agents, debateParticipants, debates, session, user, votes } from "./db/schema";
import { castVote, createDebate, enter, startDebate } from "./debate/lifecycle";

let db: Db;
let cleanup: () => void;
const NOW = 1_700_000_000_000;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
});
afterEach(() => cleanup());

async function finishedDebate(creator: string, entrants: string[]) {
  const debateId = await createDebate(db, creator, { topic: "A finished debate", maxParticipants: 2, startMode: "manual" }, NOW);
  const participants: string[] = [];
  for (const [i, u] of entrants.entries()) {
    participants.push(await enter(db, { debateId, userId: u, agentId: await seedAgent(db, u), position: i + 1 }, NOW));
  }
  await startDebate(db, { debateId, userId: creator }, NOW);
  await db.update(debates).set({ status: "completed", votingClosesAt: NOW + 60_000 }).where(eq(debates.id, debateId));
  return { debateId, participants };
}

describe("deleteAccount", () => {
  it("removes personal data and logins but keeps the anonymised row", async () => {
    await db.insert(session).values({ id: "s1", token: "t1", userId: "alice", expiresAt: new Date(NOW + 1e9), createdAt: new Date(NOW), updatedAt: new Date(NOW) });
    await db.insert(account).values({ id: "a1", accountId: "alice", providerId: "credential", userId: "alice", password: "hash", createdAt: new Date(NOW), updatedAt: new Date(NOW) });

    await deleteAccount(db, "alice", NOW);

    const [row] = await db.select().from(user).where(eq(user.id, "alice"));
    expect(row).toMatchObject({ displayName: DELETED_USER_NAME, name: DELETED_USER_NAME, email: deletedEmail("alice"), isAdmin: false, deletedAt: NOW });
    expect(await db.select().from(session).where(eq(session.userId, "alice"))).toEqual([]);
    expect(await db.select().from(account).where(eq(account.userId, "alice"))).toEqual([]);
  });

  it("deletes their agents and open debates, but keeps finished debates and their votes", async () => {
    const { debateId: finished, participants } = await finishedDebate("alice", ["alice", "bob"]);
    await castVote(db, { debateId: finished, userId: "carol", participantId: participants[0] }, NOW + 1000);
    await castVote(db, { debateId: finished, userId: "alice", participantId: participants[1] }, NOW + 1000);
    await createDebate(db, "alice", { topic: "An open debate", maxParticipants: 2, startMode: "manual" }, NOW);
    const othersOpen = await createDebate(db, "bob", { topic: "Bob's open debate", maxParticipants: 2, startMode: "manual" }, NOW);
    await enter(db, { debateId: othersOpen, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 }, NOW);

    await deleteAccount(db, "alice", NOW);

    expect(await db.select().from(agents).where(eq(agents.ownerId, "alice"))).toEqual([]);
    const remaining = (await db.select({ id: debates.id }).from(debates)).map((d) => d.id).sort();
    expect(remaining).toEqual([finished, othersOpen].sort()); // her open debate is gone
    // Her entry in Bob's open debate was withdrawn; the finished debate keeps her snapshot.
    expect(await db.select().from(debateParticipants).where(eq(debateParticipants.debateId, othersOpen))).toEqual([]);
    const [snapshot] = await db.select().from(debateParticipants).where(eq(debateParticipants.id, participants[0]));
    expect(snapshot).toMatchObject({ agentId: null, userId: "alice" });
    // Both votes still count: hers and the one for her (now deleted) agent.
    expect((await db.select().from(votes).where(eq(votes.debateId, finished))).length).toBe(2);
  });

  it("does nothing the second time", async () => {
    await deleteAccount(db, "alice", NOW);
    await deleteAccount(db, "alice", NOW + 5);
    const [row] = await db.select().from(user).where(eq(user.id, "alice"));
    expect(row.deletedAt).toBe(NOW);
  });
});
