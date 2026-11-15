import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { agents, debateParticipants, debates, turns, votes } from "../db/schema";
import { createTestDb, seedAgent, seedUser } from "../../test/helpers";
import {
  canSeeTally,
  castVote,
  computeTokenBudget,
  createDebate,
  deleteAgent,
  deleteDebate,
  enter,
  LifecycleError,
  NOT_ENOUGH_AT_START_REASON,
  startDebate,
  startDueScheduled,
  withdraw,
} from "./lifecycle";

const NOW = 1_700_000_000_000;

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedUser(db, "alice");
  await seedUser(db, "bob");
  await seedUser(db, "carol");
  await seedUser(db, "admin", { isAdmin: true });
});
afterEach(() => cleanup());

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof LifecycleError && e.code === code);
}

async function getDebate(id: string) {
  const [d] = await db.select().from(debates).where(eq(debates.id, id));
  return d;
}

async function entriesOf(debateId: string) {
  return db
    .select()
    .from(debateParticipants)
    .where(eq(debateParticipants.debateId, debateId))
    .orderBy(asc(debateParticipants.position));
}

const manual = (extra: object = {}) => ({ topic: "Should cities ban cars?", maxParticipants: 4, startMode: "manual" as const, ...extra });

describe("createDebate", () => {
  it("applies defaults", async () => {
    const id = await createDebate(db, "alice", manual(), NOW);
    const d = await getDebate(id);
    expect(d).toMatchObject({ status: "open", rounds: 3, votingDuration: "3d", tallyVisibility: "after_vote", allowMultipleEntries: false });
  });

  it("requires a future start time for scheduled debates", async () => {
    await expectCode(createDebate(db, "alice", manual({ startMode: "scheduled" }), NOW), "INVALID_INPUT");
    await expectCode(createDebate(db, "alice", manual({ startMode: "scheduled", startAt: NOW - 1 }), NOW), "INVALID_INPUT");
  });

  it("rejects out-of-range settings", async () => {
    await expectCode(createDebate(db, "alice", manual({ maxParticipants: 5 }), NOW), "INVALID_INPUT");
    await expectCode(createDebate(db, "alice", manual({ rounds: 1 }), NOW), "INVALID_INPUT");
  });
});

describe("enter and withdraw", () => {
  it("only accepts the user's own agents", async () => {
    const debateId = await createDebate(db, "alice", manual(), NOW);
    const bobsAgent = await seedAgent(db, "bob");
    await expectCode(enter(db, { debateId, userId: "alice", agentId: bobsAgent, position: 1 }), "FORBIDDEN");
  });

  it("rejects invalid and taken slots and repeat entries of the same agent", async () => {
    const debateId = await createDebate(db, "alice", manual({ allowMultipleEntries: true }), NOW);
    const a1 = await seedAgent(db, "alice");
    const b1 = await seedAgent(db, "bob");
    await expectCode(enter(db, { debateId, userId: "alice", agentId: a1, position: 5 }), "SLOT_INVALID");
    await enter(db, { debateId, userId: "alice", agentId: a1, position: 1 });
    await expectCode(enter(db, { debateId, userId: "bob", agentId: b1, position: 1 }), "SLOT_TAKEN");
    await expectCode(enter(db, { debateId, userId: "alice", agentId: a1, position: 2 }), "ALREADY_ENTERED");
  });

  it("allows one entry per user unless multiple entries are on", async () => {
    const single = await createDebate(db, "alice", manual(), NOW);
    const multi = await createDebate(db, "alice", manual({ allowMultipleEntries: true }), NOW);
    const a1 = await seedAgent(db, "alice");
    const a2 = await seedAgent(db, "alice");

    await enter(db, { debateId: single, userId: "alice", agentId: a1, position: 1 });
    await expectCode(enter(db, { debateId: single, userId: "alice", agentId: a2, position: 2 }), "ONE_ENTRY_PER_USER");

    await enter(db, { debateId: multi, userId: "alice", agentId: a1, position: 1 });
    await enter(db, { debateId: multi, userId: "alice", agentId: a2, position: 2 });
    expect(await entriesOf(multi)).toHaveLength(2);
  });

  it("frees the slot on withdraw, but not after the start", async () => {
    const debateId = await createDebate(db, "alice", manual(), NOW);
    const a1 = await seedAgent(db, "alice");
    const b1 = await seedAgent(db, "bob");
    const c1 = await seedAgent(db, "carol");
    const entryA = await enter(db, { debateId, userId: "alice", agentId: a1, position: 1 });
    await expectCode(withdraw(db, { participantId: entryA, userId: "bob" }), "FORBIDDEN");
    await withdraw(db, { participantId: entryA, userId: "alice" });
    await enter(db, { debateId, userId: "carol", agentId: c1, position: 1 });

    const entryB = await enter(db, { debateId, userId: "bob", agentId: b1, position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, NOW);
    await expectCode(withdraw(db, { participantId: entryB, userId: "bob" }), "NOT_OPEN");
  });
});

describe("starting", () => {
  it("lets only the creator start a manual debate, from 2 entries", async () => {
    const debateId = await createDebate(db, "alice", manual(), NOW);
    const b1 = await seedAgent(db, "bob");
    const c1 = await seedAgent(db, "carol");
    await enter(db, { debateId, userId: "bob", agentId: b1, position: 1 });
    await expectCode(startDebate(db, { debateId, userId: "alice" }, NOW), "NOT_ENOUGH_ENTRIES");
    await enter(db, { debateId, userId: "carol", agentId: c1, position: 3 });
    await expectCode(startDebate(db, { debateId, userId: "bob" }, NOW), "FORBIDDEN");
    await startDebate(db, { debateId, userId: "alice" }, NOW);
    expect((await getDebate(debateId)).status).toBe("running");
    await expectCode(enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 2 }), "NOT_OPEN");
  });

  it("renumbers slots keeping order, snapshots agents, suffixes duplicate names and sets the budget", async () => {
    const debateId = await createDebate(db, "alice", manual({ rounds: 2 }), NOW);
    const b1 = await seedAgent(db, "bob", { name: "Socrates", creativity: "wild", turnLength: "long" });
    const c1 = await seedAgent(db, "carol", { name: "Socrates", persona: "Another Socrates entirely." });
    await enter(db, { debateId, userId: "carol", agentId: c1, position: 4 });
    await enter(db, { debateId, userId: "bob", agentId: b1, position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, NOW);

    const entries = await entriesOf(debateId);
    expect(entries.map((e) => [e.position, e.agentId, e.name])).toEqual([
      [1, b1, "Socrates"],
      [2, c1, "Socrates (2)"],
    ]);
    expect(entries[0]).toMatchObject({ temperature: 1.3, maxOutputTokens: 400, creativity: "wild", turnLength: "long" });
    expect(entries[1].persona).toBe("Another Socrates entirely.");

    const d = await getDebate(debateId);
    expect(d).toMatchObject({ startedAt: NOW, currentRound: 1, currentTurnIndex: 0 });
    expect(d.maxTotalTokens).toBe(computeTokenBudget(2, [400, 220]));
  });

  it("starts a when_full debate on the entry that fills the last slot", async () => {
    const debateId = await createDebate(db, "alice", manual({ maxParticipants: 2, startMode: "when_full" }), NOW);
    await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
    expect((await getDebate(debateId)).status).toBe("open");
    await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2 });
    expect((await getDebate(debateId)).status).toBe("running");
  });

  it("only lets the creator start manual debates", async () => {
    const debateId = await createDebate(db, "alice", manual({ startMode: "when_full" }), NOW);
    await expectCode(startDebate(db, { debateId, userId: "alice" }, NOW), "WRONG_START_MODE");
  });

  it("starts due scheduled debates with 2+ entries and cancels those with fewer", async () => {
    const at = NOW + 60_000;
    const ready = await createDebate(db, "alice", manual({ startMode: "scheduled", startAt: at }), NOW);
    const lonely = await createDebate(db, "alice", manual({ startMode: "scheduled", startAt: at }), NOW);
    const later = await createDebate(db, "alice", manual({ startMode: "scheduled", startAt: at * 2 }), NOW);
    await enter(db, { debateId: ready, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
    await enter(db, { debateId: ready, userId: "bob", agentId: await seedAgent(db, "bob"), position: 3 });
    await enter(db, { debateId: lonely, userId: "carol", agentId: await seedAgent(db, "carol"), position: 1 });

    expect(await startDueScheduled(db, at - 1)).toEqual({ started: [], cancelled: [] });
    const result = await startDueScheduled(db, at);
    expect(result).toEqual({ started: [ready], cancelled: [lonely] });
    expect((await getDebate(ready)).status).toBe("running");
    expect(await getDebate(lonely)).toMatchObject({ status: "cancelled", cancelReason: NOT_ENOUGH_AT_START_REASON });
    expect((await getDebate(later)).status).toBe("open");
  });
});

async function runningDebate() {
  const debateId = await createDebate(db, "alice", manual(), NOW);
  const a1 = await seedAgent(db, "alice");
  const b1 = await seedAgent(db, "bob");
  const entryA = await enter(db, { debateId, userId: "alice", agentId: a1, position: 1 });
  const entryB = await enter(db, { debateId, userId: "bob", agentId: b1, position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, NOW);
  return { debateId, a1, b1, entryA, entryB };
}

describe("deleting", () => {
  it("lets the creator delete only while open, and admins at any time, removing everything", async () => {
    const { debateId, entryA } = await runningDebate();
    await expectCode(deleteDebate(db, { debateId, userId: "alice", isAdmin: false }), "NOT_OPEN");
    await db.insert(turns).values({
      id: "t1", debateId, participantId: entryA, round: 1, seq: 1, kind: "opening", status: "complete", content: "Hi.", createdAt: NOW, updatedAt: NOW,
    });
    await deleteDebate(db, { debateId, userId: "admin", isAdmin: true });
    expect(await getDebate(debateId)).toBeUndefined();
    expect(await entriesOf(debateId)).toHaveLength(0);
    expect(await db.select().from(turns).where(eq(turns.debateId, debateId))).toHaveLength(0);

    const open = await createDebate(db, "alice", manual(), NOW);
    await expectCode(deleteDebate(db, { debateId: open, userId: "bob", isAdmin: false }), "FORBIDDEN");
    await deleteDebate(db, { debateId: open, userId: "alice", isAdmin: false });
    expect(await getDebate(open)).toBeUndefined();
  });

  it("hard-deletes an agent: withdrawn from open debates, kept as a snapshot in started ones", async () => {
    const { debateId: started, a1, entryA } = await runningDebate();
    const open = await createDebate(db, "carol", manual(), NOW);
    await enter(db, { debateId: open, userId: "alice", agentId: a1, position: 1 });

    await expectCode(deleteAgent(db, { agentId: a1, userId: "bob", isAdmin: false }), "FORBIDDEN");
    await deleteAgent(db, { agentId: a1, userId: "alice", isAdmin: false });

    expect(await db.select().from(agents).where(eq(agents.id, a1))).toHaveLength(0);
    expect(await entriesOf(open)).toHaveLength(0);
    const [kept] = await db.select().from(debateParticipants).where(eq(debateParticipants.id, entryA));
    expect(kept.agentId).toBeNull();
    expect(kept.name).not.toBeNull();
    expect((await getDebate(started)).status).toBe("running");
  });

  it("lets an admin delete anyone's agent", async () => {
    const agentId = await seedAgent(db, "bob");
    await deleteAgent(db, { agentId, userId: "admin", isAdmin: true });
    expect(await db.select().from(agents).where(eq(agents.id, agentId))).toHaveLength(0);
  });
});

describe("voting", () => {
  async function completedDebate() {
    const r = await runningDebate();
    const completedAt = NOW + 1000;
    await db
      .update(debates)
      .set({ status: "completed", completedAt, votingClosesAt: completedAt + 3 * 24 * 3600 * 1000 })
      .where(eq(debates.id, r.debateId));
    return { ...r, completedAt };
  }

  it("rejects votes before completion", async () => {
    const { debateId, entryA } = await runningDebate();
    await expectCode(castVote(db, { debateId, userId: "carol", participantId: entryA }, NOW), "NOT_COMPLETED");
  });

  it("allows one vote per user, never for their own agent, until voting closes", async () => {
    const { debateId, entryA, entryB, completedAt } = await completedDebate();
    await expectCode(castVote(db, { debateId, userId: "alice", participantId: entryA }, completedAt), "OWN_AGENT");
    await castVote(db, { debateId, userId: "alice", participantId: entryB }, completedAt);
    await expectCode(castVote(db, { debateId, userId: "alice", participantId: entryB }, completedAt), "ALREADY_VOTED");
    const closes = completedAt + 3 * 24 * 3600 * 1000;
    await castVote(db, { debateId, userId: "carol", participantId: entryA }, closes - 1);
    await expectCode(castVote(db, { debateId, userId: "admin", participantId: entryA }, closes), "VOTING_CLOSED");
    expect(await db.select().from(votes).where(eq(votes.debateId, debateId))).toHaveLength(2);
  });

  it("blocks every agent a user owns, not just one", async () => {
    const debateId = await createDebate(db, "alice", manual({ allowMultipleEntries: true }), NOW);
    const e1 = await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
    const e2 = await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, NOW);
    await db.update(debates).set({ status: "completed", completedAt: NOW, votingClosesAt: NOW + 1000 }).where(eq(debates.id, debateId));
    await expectCode(castVote(db, { debateId, userId: "alice", participantId: e1 }, NOW), "OWN_AGENT");
    await expectCode(castVote(db, { debateId, userId: "alice", participantId: e2 }, NOW), "OWN_AGENT");
    await castVote(db, { debateId, userId: "bob", participantId: e2 }, NOW);
  });
});

describe("canSeeTally", () => {
  const closes = NOW + 1000;
  const cases = [
    ["live", false, NOW, true],
    ["after_vote", false, NOW, false],
    ["after_vote", true, NOW, true],
    ["after_close", true, NOW, false],
    ["after_close", false, closes, true],
    ["after_vote", false, closes, true],
  ] as const;
  it.each(cases)("%s, voted=%s, at %s → %s", (tallyVisibility, hasVoted, now, expected) => {
    expect(canSeeTally({ tallyVisibility, votingClosesAt: closes }, { hasVoted }, now)).toBe(expected);
  });
});
