import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogAvailability } from "../ai/models";
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
  emptySideReason,
  NOT_ENOUGH_AT_START_REASON,
  resumeDebate,
  startDebate,
  startDueScheduled,
  withdraw,
} from "./lifecycle";
import { explainFailure } from "./explain-error";

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

  it("runs a retired model's agent on the provider default and records what it replaced", async () => {
    const debateId = await createDebate(db, "alice", manual(), NOW);
    const retired = await seedAgent(db, "alice", { provider: "groq", modelId: "llama-3.3-70b-versatile" });
    const current = await seedAgent(db, "bob", { provider: "groq", modelId: "openai/gpt-oss-20b" });
    const missingOllama = await seedAgent(db, "carol", { provider: "ollama", modelId: "mistral" });
    await enter(db, { debateId, userId: "alice", agentId: retired, position: 1 });
    await enter(db, { debateId, userId: "bob", agentId: current, position: 2 });
    await enter(db, { debateId, userId: "carol", agentId: missingOllama, position: 3 });
    await startDebate(db, { debateId, userId: "alice" }, NOW, catalogAvailability(["llama3.2:latest"]));

    const entries = await entriesOf(debateId);
    expect(entries.map((e) => [e.modelId, e.modelFallbackFrom])).toEqual([
      ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
      ["openai/gpt-oss-20b", null],
      ["llama3.2", "mistral"],
    ]);
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

describe("resuming a failed debate", () => {
  it("lets the creator or an admin resume it, clearing the error", async () => {
    const { debateId } = await runningDebate();
    await db.update(debates).set({ status: "failed", errorMessage: "boom", retryCount: 3 }).where(eq(debates.id, debateId));

    await expectCode(resumeDebate(db, { debateId, userId: "bob", isAdmin: false }), "FORBIDDEN");
    await resumeDebate(db, { debateId, userId: "alice", isAdmin: false });
    expect(await getDebate(debateId)).toMatchObject({ status: "running", errorMessage: null, retryCount: 0 });

    await expectCode(resumeDebate(db, { debateId, userId: "admin", isAdmin: true }), "NOT_FAILED");
  });

  it("switches participants on a retired model to the provider default, so resuming can work", async () => {
    const debateId = await createDebate(db, "alice", manual(), NOW);
    await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { provider: "groq", modelId: "openai/gpt-oss-20b" }), position: 1 });
    await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { provider: "groq", modelId: "openai/gpt-oss-20b" }), position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, NOW);
    // Since the start, Bob's snapshot model was retired (simulated by an unknown, retired catalog id).
    const [, bob] = await entriesOf(debateId);
    await db.update(debateParticipants).set({ modelId: "llama-3.3-70b-versatile" }).where(eq(debateParticipants.id, bob.id));
    await db.update(debates).set({ status: "failed", errorMessage: "The model does not exist" }).where(eq(debates.id, debateId));

    await resumeDebate(db, { debateId, userId: "alice", isAdmin: false });
    expect((await entriesOf(debateId)).map((e) => [e.modelId, e.modelFallbackFrom])).toEqual([
      ["openai/gpt-oss-20b", null],
      ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    ]);
  });
});

describe("explainFailure", () => {
  it("turns common errors into plain language", () => {
    expect(explainFailure("GROQ_API_KEY is not set, so Groq models can't be used.").summary).toMatch(/API key is missing/);
    expect(explainFailure("The model `x` does not exist or you do not have access to it.").summary).toMatch(/isn't available/);
    expect(explainFailure("The model returned an empty turn.").summary).toMatch(/empty replies/);
    expect(explainFailure(null).canResume).toBe(true);
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

describe("for-or-against debates", () => {
  const sides = (extra: object = {}) => manual({ mode: "sides", maxParticipants: 3, allowMultipleEntries: true, ...extra });

  it("needs a side for every entry, and keeps the last free slot for the empty side", async () => {
    const id = await createDebate(db, "alice", sides(), NOW);
    expect((await getDebate(id)).mode).toBe("sides");
    const a1 = await seedAgent(db, "alice", { name: "Ada" });
    await expectCode(enter(db, { debateId: id, userId: "alice", agentId: a1, position: 1 }, NOW), "SIDE_NEEDED");
    await enter(db, { debateId: id, userId: "alice", agentId: a1, position: 1, side: "for" }, NOW);
    await enter(db, { debateId: id, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram" }), position: 2, side: "for" }, NOW);

    // One slot left and nobody against: it can only go to Against.
    const cleo = await seedAgent(db, "carol", { name: "Cleo" });
    await expect(enter(db, { debateId: id, userId: "carol", agentId: cleo, position: 3, side: "for" }, NOW)).rejects.toThrow(
      "The last slot is for Against: each side needs at least one agent.",
    );
    await enter(db, { debateId: id, userId: "carol", agentId: cleo, position: 3, side: "against" }, NOW);
    expect((await entriesOf(id)).map((e) => e.side)).toEqual(["for", "for", "against"]);
  });

  it("ignores a side in an open discussion", async () => {
    const id = await createDebate(db, "alice", manual(), NOW);
    await enter(db, { debateId: id, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1, side: "for" }, NOW);
    expect((await entriesOf(id))[0].side).toBeNull();
  });

  it("won't start by hand until both sides have an agent", async () => {
    const id = await createDebate(db, "alice", sides({ maxParticipants: 4 }), NOW);
    await enter(db, { debateId: id, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1, side: "against" }, NOW);
    await enter(db, { debateId: id, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2, side: "against" }, NOW);
    await expectCode(startDebate(db, { debateId: id, userId: "alice" }, NOW), "NOT_ENOUGH_SIDES");
    await enter(db, { debateId: id, userId: "carol", agentId: await seedAgent(db, "carol"), position: 4, side: "for" }, NOW);
    await startDebate(db, { debateId: id, userId: "alice" }, NOW);
    expect((await getDebate(id)).status).toBe("running");
  });

  it("renumbers the slots at start so For opens and the sides take turns", async () => {
    const id = await createDebate(db, "alice", sides({ maxParticipants: 4, startMode: "when_full" }), NOW);
    const enterAs = async (user: string, name: string, position: number, side: "for" | "against") =>
      enter(db, { debateId: id, userId: user, agentId: await seedAgent(db, user, { name }), position, side }, NOW);
    await enterAs("alice", "Cleo", 1, "against");
    await enterAs("alice", "Dev", 2, "against");
    await enterAs("bob", "Ada", 3, "for");
    await enterAs("bob", "Bram", 4, "for"); // fills it: it starts
    expect((await getDebate(id)).status).toBe("running");
    expect((await entriesOf(id)).map((e) => [e.position, e.name, e.side])).toEqual([
      [1, "Ada", "for"],
      [2, "Cleo", "against"],
      [3, "Bram", "for"],
      [4, "Dev", "against"],
    ]);
  });

  it("cancels a scheduled debate when a side is still empty at its start time", async () => {
    const id = await createDebate(db, "alice", sides({ startMode: "scheduled", startAt: NOW + 1000 }), NOW);
    await enter(db, { debateId: id, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1, side: "for" }, NOW);
    await enter(db, { debateId: id, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2, side: "for" }, NOW);
    expect(await startDueScheduled(db, NOW + 2000, catalogAvailability([]))).toEqual({ started: [], cancelled: [id] });
    expect(await getDebate(id)).toMatchObject({ status: "cancelled", cancelReason: emptySideReason("against") });
  });

  it("asks viewers which side convinced them, but not owners of an agent in it", async () => {
    const id = await createDebate(db, "alice", sides({ maxParticipants: 2 }), NOW);
    const ada = await enter(db, { debateId: id, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1, side: "for" }, NOW);
    const bram = await enter(db, { debateId: id, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2, side: "against" }, NOW);
    await db.update(debates).set({ status: "completed", completedAt: NOW, votingClosesAt: NOW + 1000 }).where(eq(debates.id, id));

    await expectCode(castVote(db, { debateId: id, userId: "carol", participantId: ada }, NOW), "SIDE_NEEDED");
    await castVote(db, { debateId: id, userId: "carol", participantId: ada, side: "against" }, NOW);
    // Alice owns Ada: her side is dropped even if sent; she still picks the best agent.
    await castVote(db, { debateId: id, userId: "alice", participantId: bram, side: "for" }, NOW);
    const rows = await db.select({ userId: votes.userId, side: votes.side }).from(votes).where(eq(votes.debateId, id));
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.side]))).toEqual({ carol: "against", alice: null });
  });
});
