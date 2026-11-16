import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, rateLimitedModel, scriptedModel, seedAgent, seedUser, testClock } from "../../test/helpers";
import type { ModelResolver } from "../ai/provider";
import type { Db } from "../db/client";
import { debateParticipants } from "../db/schema";
import { saveConnection } from "../openrouter";
import { runStep, sharedDailyLimitReached } from "./engine";
import { createDebate, enter, startDebate } from "./lifecycle";

/**
 * The app's free models (Groq, Google) share one daily limit across all users. When it's used up,
 * an agent on it is skipped if others in the debate can still speak on other quotas; otherwise the
 * debate waits for the reset.
 */
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

const GROQ = { provider: "groq" as const, modelId: "openai/gpt-oss-120b" };
const PAID = { provider: "openrouter" as const, modelId: "anthropic/claude-haiku-5.5" };

async function debateWith(ada: object, bram: object) {
  const debateId = await createDebate(db, "alice", { topic: "Ban cars?", rounds: 2, maxParticipants: 2, startMode: "manual" }, clock.now());
  await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Ada", ...ada }), position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram", ...bram }), position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, clock.now());
  return debateId;
}

/** Groq calls hit the limit (retry after `retryAfterS`); everything else answers. */
function groqLimited(retryAfterS: number): ModelResolver {
  const limited = rateLimitedModel(retryAfterS);
  const fine = scriptedModel(["A turn."]);
  return (provider) => (provider === "groq" ? limited : fine);
}

const silencedOf = async (debateId: string) =>
  (await db.select().from(debateParticipants).where(eq(debateParticipants.debateId, debateId)).orderBy(asc(debateParticipants.position))).map(
    (p) => p.silencedReason,
  );

describe("the app's shared daily limit", () => {
  it("tells a daily limit from a per-minute one by when it lifts", () => {
    const err = (s: number) => ({ statusCode: 429, responseHeaders: { "retry-after": String(s) } });
    expect(sharedDailyLimitReached(err(6 * 3600))).toBe(true);
    expect(sharedDailyLimitReached(err(20))).toBe(false);
    expect(sharedDailyLimitReached({ statusCode: 500 })).toBe(false);
  });

  it("skips the agent on it when others can still speak, so a paid agent isn't held up", async () => {
    await saveConnection(db, "bob", "sk-or-bob");
    const debateId = await debateWith(GROQ, PAID);
    const resolve = groqLimited(6 * 3600);

    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toEqual({
      kind: "silenced",
      speaker: "Ada",
      reason: "Agent Arena's free Groq limit is used up for today",
    });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram" });
    expect(await runStep(db, debateId, { resolveModel: resolve, now: clock.now })).toMatchObject({ kind: "turn", speaker: "Bram", debateCompleted: true });
  });

  it("waits for the reset when everyone left depends on the same limit", async () => {
    const debateId = await debateWith(GROQ, GROQ);
    expect(await runStep(db, debateId, { resolveModel: groqLimited(6 * 3600), now: clock.now })).toMatchObject({ kind: "waiting" });
    expect(await silencedOf(debateId)).toEqual([null, null]);
  });

  it("waits out a per-minute limit, even with others who could speak", async () => {
    await saveConnection(db, "bob", "sk-or-bob");
    const debateId = await debateWith(GROQ, PAID);
    expect(await runStep(db, debateId, { resolveModel: groqLimited(20), now: clock.now })).toMatchObject({ kind: "waiting" });
    expect(await silencedOf(debateId)).toEqual([null, null]);
  });
});
