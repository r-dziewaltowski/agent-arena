import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, httpErrorModel, scriptedModel, seedAgent, seedUser, testClock } from "../../test/helpers";
import type { ModelResolver } from "../ai/provider";
import type { Db } from "../db/client";
import { debateParticipants, debates, turns } from "../db/schema";
import { getConnection, saveConnection } from "../openrouter";
import { runStep } from "./engine";
import { createDebate, enter, startDebate } from "./lifecycle";

/** Paid agents (OpenRouter, on their owner's own key) in the engine: keys, silencing, skipping. */
let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;

beforeEach(async () => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", randomBytes(32).toString("base64"));
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  for (const id of ["alice", "bob"]) await seedUser(db, id);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const PAID = { provider: "openrouter" as const, modelId: "anthropic/claude-haiku-5.5" };

/** Alice's agent Ada speaks first, Bob's Bram second; `paid` picks whose agents run on OpenRouter. */
async function debateWith(paid: { ada?: boolean; bram?: boolean }, rounds = 2) {
  const debateId = await createDebate(db, "alice", { topic: "Should cities ban cars?", rounds, maxParticipants: 2, startMode: "manual" }, clock.now());
  await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Ada", ...(paid.ada ? PAID : {}) }), position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram", ...(paid.bram ? PAID : {}) }), position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, clock.now());
  return debateId;
}

const participants = (debateId: string) =>
  db.select().from(debateParticipants).where(eq(debateParticipants.debateId, debateId)).orderBy(asc(debateParticipants.position));
const debateRow = async (id: string) => (await db.select().from(debates).where(eq(debates.id, id)))[0];

/** A resolver that records which key each call got, answering with `model` for paid calls. */
function recordingResolver(paidModel = scriptedModel(["A paid turn."])) {
  const calls: { provider: string; apiKey?: string }[] = [];
  const free = scriptedModel(["A free turn."]);
  const resolve: ModelResolver = (provider, _modelId, opts) => {
    calls.push({ provider, apiKey: opts?.apiKey });
    return provider === "openrouter" ? paidModel : free;
  };
  return { resolve, calls };
}

describe("paid agents", () => {
  it("speak on their own owner's key", async () => {
    await saveConnection(db, "alice", "sk-or-alice");
    const debateId = await debateWith({ ada: true });
    const { resolve, calls } = recordingResolver();

    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Ada" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram" });
    expect(calls).toEqual([{ provider: "openrouter", apiKey: "sk-or-alice" }, { provider: "ollama", apiKey: undefined }]);
    expect((await getConnection(db, "alice"))?.failedAt).toBeNull();
  });

  it("are silenced when their owner's key is refused, and the debate carries on without them", async () => {
    await saveConnection(db, "alice", "sk-or-alice");
    const debateId = await debateWith({ ada: true });
    const { resolve } = recordingResolver(httpErrorModel(402));

    const outcome = await runStep(db, debateId, { resolveModel: resolve, now: clock.now });
    expect(outcome).toEqual({ kind: "silenced", speaker: "Ada", reason: "its owner's OpenRouter account is out of credit" });
    expect((await participants(debateId))[0]).toMatchObject({ silencedReason: "its owner's OpenRouter account is out of credit" });
    expect(await getConnection(db, "alice")).toMatchObject({ failReason: "its owner's OpenRouter account is out of credit" });
    expect(await db.select().from(turns).where(eq(turns.debateId, debateId))).toEqual([]); // no half turn left behind

    // Bram speaks; Ada's later turns are skipped, so Bram closes the debate.
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram", debateCompleted: true });
    expect((await debateRow(debateId)).status).toBe("completed");
  });

  it("are silenced from the start when their owner has disconnected", async () => {
    const debateId = await debateWith({ bram: true }); // Bob never connected
    const { resolve, calls } = recordingResolver();

    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Ada" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toEqual({
      kind: "silenced",
      speaker: "Bram",
      reason: "its owner disconnected OpenRouter",
    });
    expect(calls.map((c) => c.provider)).toEqual(["ollama"]); // Bram's model was never called
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Ada", debateCompleted: true });
  });

  it("end the debate when only silenced agents are left to speak", async () => {
    await saveConnection(db, "bob", "sk-or-bob");
    const debateId = await debateWith({ bram: true });
    const { resolve } = recordingResolver(httpErrorModel(401));

    await runStep(db, debateId, { resolveModel: resolve, now: clock.now }); // Ada, round 1
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "silenced", speaker: "Bram" });
    await runStep(db, debateId, { resolveModel: resolve, now: clock.now }); // Ada, round 2 (closing)
    expect((await debateRow(debateId)).status).toBe("completed");
  });

  it("fail the debate when nobody can speak", async () => {
    const debateId = await debateWith({ ada: true, bram: true }); // neither owner connected
    const { resolve } = recordingResolver();
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "silenced", speaker: "Ada" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "silenced", speaker: "Bram" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "failed" });
    expect((await debateRow(debateId)).errorMessage).toMatch(/No agent can speak/);
  });

  it("are silenced when their owner's account has used up today's free requests", async () => {
    await saveConnection(db, "alice", "sk-or-alice");
    const debateId = await debateWith({ ada: true });
    const resetsTomorrow = { responseHeaders: { "X-RateLimit-Reset": String(clock.now() + 9 * 3_600_000) } };
    const { resolve } = recordingResolver(httpErrorModel(429, resetsTomorrow));
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toEqual({
      kind: "silenced",
      speaker: "Ada",
      reason: "its owner's OpenRouter account used up today's free requests",
    });
    // Bram (another owner) carries on straight away.
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram" });
  });

  it("wait out a per-minute limit or a busy model (429), instead of being silenced", async () => {
    await saveConnection(db, "alice", "sk-or-alice");
    const debateId = await debateWith({ ada: true });
    const resetsSoon = { responseHeaders: { "x-ratelimit-reset": String(clock.now() + 30_000) } };
    const { resolve } = recordingResolver(httpErrorModel(429, resetsSoon));
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "waiting" });
    expect((await participants(debateId))[0].silencedAt).toBeNull();
  });

  it("wait out a busy model (429) like free models do, instead of being silenced", async () => {
    await saveConnection(db, "alice", "sk-or-alice");
    const debateId = await debateWith({ ada: true });
    const { resolve } = recordingResolver(httpErrorModel(429));
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "waiting" });
    expect((await participants(debateId))[0].silencedAt).toBeNull();
  });
});
