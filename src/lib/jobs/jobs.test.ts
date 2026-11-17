import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogAvailability } from "../ai/models";
import type { Db } from "../db/client";
import { debates, turns } from "../db/schema";
import { LOCK_TTL_MS } from "../debate/engine";
import { createDebate, enter, startDebate } from "../debate/lifecycle";
import { PAUSE_BETWEEN_TURNS_MS } from "../debate/pacing";
import {
  createTestDb,
  resolverFor,
  scriptedModel,
  seedAgent,
  seedUser,
  testClock,
  unreachableModel,
} from "../../test/helpers";
import { advanceDebate, QUEUE_DELAYED, queueDebate, type JobDeps } from "./advance";
import type { JobQueue } from "./queue";
import { deliveryTime, fakeQueue, MAX_DELAY_MS } from "./queue";
import { STALL_MS, sweep } from "./sweep";
import { isQueueRequest } from "./verify";

let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;
let q: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  q = fakeQueue();
  await seedUser(db, "alice");
  await seedUser(db, "bob");
});
afterEach(() => cleanup());

function deps(model = scriptedModel(["A fair point."])): JobDeps {
  return {
    queue: q.queue,
    now: clock.now,
    resolveModel: resolverFor(model),
    getAvailability: async () => catalogAvailability(),
  };
}

async function manualDebate(rounds = 2) {
  const debateId = await createDebate(
    db,
    "alice",
    { topic: "Should cities ban cars?", rounds, maxParticipants: 2, startMode: "manual" },
    clock.now(),
  );
  await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2 });
  return debateId;
}

async function scheduledDebate(startAt: number, entries = 2) {
  const debateId = await createDebate(
    db,
    "alice",
    { topic: "Scheduled topic here", maxParticipants: 3, startMode: "scheduled", startAt },
    clock.now(),
  );
  if (entries >= 1) await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
  if (entries >= 2) await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2 });
  return debateId;
}

async function getDebate(id: string) {
  const [d] = await db.select().from(debates).where(eq(debates.id, id));
  return d;
}

/** Delivers queued messages one by one, like QStash, moving the clock to each delivery time. */
async function drain(d: JobDeps, limit = 50) {
  let delivered = 0;
  while (q.messages.length && delivered < limit) {
    const msg = q.messages.shift()!;
    if (msg.at !== undefined && msg.at > clock.now()) clock.set(msg.at);
    await advanceDebate(db, msg.debateId, d);
    clock.advance(1000);
    delivered++;
  }
  return delivered;
}

describe("advanceDebate", () => {
  it("runs a started debate to completion by following its own messages", async () => {
    const id = await manualDebate(2);
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    await queueDebate(db, id, q.queue, { now: clock.now() });
    expect(q.messages).toEqual([{ debateId: id }]);

    // 4 turns, each queuing the next; the last one queues nothing.
    expect(await drain(deps())).toBe(4);
    expect((await getDebate(id)).status).toBe("completed");
    const saved = await db.select().from(turns).where(eq(turns.debateId, id)).orderBy(asc(turns.seq));
    expect(saved.map((t) => t.seq)).toEqual([1, 2, 3, 4]);
    expect(q.messages).toEqual([]);
  });

  it("queues the next try at nextAttemptAt when the model is unreachable", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());

    const result = await advanceDebate(db, id, deps(unreachableModel()));
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "waiting" } });
    const { nextAttemptAt } = await getDebate(id);
    expect(nextAttemptAt).toBeGreaterThan(clock.now());
    expect(q.messages).toEqual([{ debateId: id, at: nextAttemptAt }]);
  });

  it("queues a retry after a bad turn", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());

    const result = await advanceDebate(db, id, deps(scriptedModel([""])));
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "retrying" } });
    const { nextAttemptAt } = await getDebate(id);
    expect(q.messages).toEqual([{ debateId: id, at: nextAttemptAt }]);
  });

  it("queues again when a message arrives before nextAttemptAt", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    const at = clock.now() + 30_000;
    await db.update(debates).set({ nextAttemptAt: at }).where(eq(debates.id, id));

    const result = await advanceDebate(db, id, deps());
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "skipped" }, requeuedFor: at });
    expect(q.messages).toEqual([{ debateId: id, at }]);
  });

  it("stops when another call holds the lock (that call queues the next step)", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    await db.update(debates).set({ lockToken: "other", lockedAt: clock.now() }).where(eq(debates.id, id));

    const result = await advanceDebate(db, id, deps());
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "skipped" }, requeuedFor: null });
    expect(q.messages).toEqual([]);
  });

  it("queues the next turn for when the last one has been read", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    const result = await advanceDebate(db, id, { ...deps(scriptedModel(["One two three four five six seven eight nine."])), wordsPerSecond: 3 });
    const at = clock.now() + 3_000 + PAUSE_BETWEEN_TURNS_MS;
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "turn", seq: 1 }, requeuedFor: at });
    expect(q.messages).toEqual([{ debateId: id, at }]);
  });

  it("does nothing for deleted, open manual and finished debates", async () => {
    expect(await advanceDebate(db, "missing", deps())).toEqual({ kind: "gone" });
    const id = await manualDebate();
    expect(await advanceDebate(db, id, deps())).toEqual({ kind: "idle", status: "open" });
    await db.update(debates).set({ status: "completed" }).where(eq(debates.id, id));
    expect(await advanceDebate(db, id, deps())).toEqual({ kind: "idle", status: "completed" });
    expect(q.messages).toEqual([]);
  });

  it("starts a scheduled debate from its delayed message and generates the first turn", async () => {
    const at = clock.now() + 60_000;
    const id = await scheduledDebate(at);
    await queueDebate(db, id, q.queue, { now: clock.now() });
    expect(q.messages).toEqual([{ debateId: id, at }]);

    // Delivered early (clock differences, or a start beyond the maximum delay): queue it again.
    q.messages.length = 0;
    expect(await advanceDebate(db, id, deps())).toEqual({ kind: "not_due", requeuedFor: at });
    expect(q.messages).toEqual([{ debateId: id, at }]);

    q.messages.length = 0;
    clock.set(at);
    const result = await advanceDebate(db, id, deps());
    expect(result).toMatchObject({ kind: "step", outcome: { kind: "turn", seq: 1 }, requeuedFor: "now" });
    expect((await getDebate(id)).status).toBe("running");
    expect(q.messages).toEqual([{ debateId: id }]);
  });

  it("cancels a scheduled debate with fewer than 2 entries", async () => {
    const at = clock.now() + 60_000;
    const id = await scheduledDebate(at, 1);
    clock.set(at);
    expect(await advanceDebate(db, id, deps())).toEqual({ kind: "cancelled" });
    expect((await getDebate(id)).status).toBe("cancelled");
    expect(q.messages).toEqual([]);
  });
});

describe("queueDebate", () => {
  it("queues nothing for an open manual debate", async () => {
    const id = await manualDebate();
    await queueDebate(db, id, q.queue, { now: clock.now() });
    expect(q.messages).toEqual([]);
  });

  it("with runningOnly, queues a started debate but not another scheduled-start message", async () => {
    const scheduled = await scheduledDebate(clock.now() + 60_000);
    await queueDebate(db, scheduled, q.queue, { now: clock.now(), runningOnly: true });
    expect(q.messages).toEqual([]);

    const started = await manualDebate();
    await startDebate(db, { debateId: started, userId: "alice" }, clock.now());
    await queueDebate(db, started, q.queue, { now: clock.now(), runningOnly: true });
    expect(q.messages).toEqual([{ debateId: started }]);
  });
});

describe("deliveryTime", () => {
  it("is undefined for now or the past, rounds up to whole seconds, and caps at the maximum delay", () => {
    const now = 1_700_000_000_000;
    expect(deliveryTime(undefined, now)).toBeUndefined();
    expect(deliveryTime(now - 1, now)).toBeUndefined();
    expect(deliveryTime(now + 1_500, now)).toBe(Math.ceil((now + 1_500) / 1000));
    expect(deliveryTime(now + 30 * 24 * 60 * 60_000, now)).toBe(Math.ceil((now + MAX_DELAY_MS) / 1000));
  });
});

describe("sweep", () => {
  it("restarts a running debate that lost its message, but not active, locked or waiting ones", async () => {
    const stalled = await manualDebate();
    await startDebate(db, { debateId: stalled, userId: "alice" }, clock.now());
    const locked = await manualDebate();
    await startDebate(db, { debateId: locked, userId: "alice" }, clock.now());
    const waiting = await manualDebate();
    await startDebate(db, { debateId: waiting, userId: "alice" }, clock.now());

    clock.advance(STALL_MS + 1000);
    await db.update(debates).set({ lockToken: "busy", lockedAt: clock.now() - 1000 }).where(eq(debates.id, locked));
    await db.update(debates).set({ nextAttemptAt: clock.now() + 60_000 }).where(eq(debates.id, waiting));
    const fresh = await manualDebate();
    await startDebate(db, { debateId: fresh, userId: "alice" }, clock.now());

    const result = await sweep(db, deps());
    expect(result.restarted).toEqual([stalled]);
    expect(q.messages).toEqual([{ debateId: stalled }]);
  });

  it("treats an abandoned lock as stalled", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    await db.update(debates).set({ lockToken: "crashed", lockedAt: clock.now() }).where(eq(debates.id, id));
    clock.advance(Math.max(LOCK_TTL_MS, STALL_MS) + 1000);
    expect((await sweep(db, deps())).restarted).toEqual([id]);
  });

  it("starts or cancels overdue scheduled debates", async () => {
    const at = clock.now() + 60_000;
    const full = await scheduledDebate(at);
    const empty = await scheduledDebate(at, 1);
    clock.set(at + 5 * 60_000);

    const result = await sweep(db, deps());
    expect(result.started).toEqual([full]);
    expect(result.cancelled).toEqual([empty]);
    expect(q.messages).toEqual([{ debateId: full }]);
  });
});

describe("isQueueRequest", () => {
  it("rejects requests without a valid QStash signature", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_test_current";
    process.env.QSTASH_NEXT_SIGNING_KEY = "sig_test_next";
    const body = JSON.stringify({ debateId: "x" });
    const unsigned = new Request("http://localhost:3000/api/jobs/advance", { method: "POST", body });
    expect(await isQueueRequest(unsigned, body, "/api/jobs/advance")).toBe(false);
    const forged = new Request("http://localhost:3000/api/jobs/advance", {
      method: "POST",
      body,
      headers: { "upstash-signature": "not.a.jwt" },
    });
    expect(await isQueueRequest(forged, body, "/api/jobs/advance")).toBe(false);
  });
});

describe("when the queue refuses (down, or its daily limit reached)", () => {
  const refusingQueue: JobQueue = {
    async enqueueAdvance() {
      throw new Error("QStash: daily message limit reached");
    },
  };

  it("marks a just-started debate as delayed instead of leaving it silently stuck", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    await expect(queueDebate(db, id, refusingQueue, { now: clock.now() })).rejects.toThrow(/limit/);
    expect((await getDebate(id)).waitingReason).toBe(QUEUE_DELAYED);

    // Once the queue works again, the next turn clears the notice.
    await advanceDebate(db, id, deps());
    expect((await getDebate(id)).waitingReason).toBeNull();
  });

  it("marks the debate when the next step after a turn can't be queued", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    await expect(advanceDebate(db, id, { ...deps(), queue: refusingQueue })).rejects.toThrow(/limit/);
    expect(await getDebate(id)).toMatchObject({ status: "running", waitingReason: QUEUE_DELAYED });
  });

  it("lets the sweep carry on, marking each debate it couldn't restart", async () => {
    const id = await manualDebate();
    await startDebate(db, { debateId: id, userId: "alice" }, clock.now());
    clock.advance(STALL_MS + 1000);
    const result = await sweep(db, { ...deps(), queue: refusingQueue });
    expect(result).toMatchObject({ restarted: [], delayed: [id] });
    expect((await getDebate(id)).waitingReason).toBe(QUEUE_DELAYED);
  });
});
