import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { debateParticipants, debates, turnAudio, turns } from "../db/schema";
import { AUDIO_KEPT_AFTER_SHOWN_MS } from "../voice/cleanup";
import { parseMarks, type Mark } from "../voice/marks";
import type { SpeechMaker, SpeechRequest } from "../voice/speech";
import { VOTING_DURATIONS } from "../validation/debate";
import {
  createTestDb,
  rateLimitedModel,
  resolverFor,
  scriptedModel,
  seedAgent,
  seedUser,
  testClock,
  unreachableModel,
} from "../../test/helpers";
import {
  isModelUnreachable,
  LOCK_TTL_MS,
  isRateLimited,
  MAX_BAD_TURN_RETRIES,
  RATE_LIMITED,
  retryAfterMs,
  runStep,
  WAITING_FOR_MODEL,
  waitDelayMs,
} from "./engine";
import { createDebate, enter, startDebate } from "./lifecycle";
import { PAUSE_BETWEEN_TURNS_MS, PREPARE_AHEAD_MS, SPEECH_PLAYBACK_RATE } from "./pacing";

let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  await seedUser(db, "alice");
  await seedUser(db, "bob");
});
afterEach(() => cleanup());

async function startedDebate(rounds = 2) {
  const debateId = await createDebate(
    db,
    "alice",
    { topic: "Should cities ban cars?", rounds, maxParticipants: 2, startMode: "manual" },
    clock.now(),
  );
  await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Ada" }), position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram" }), position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, clock.now());
  return debateId;
}

async function getDebate(id: string) {
  const [d] = await db.select().from(debates).where(eq(debates.id, id));
  return d;
}

async function turnsOf(id: string) {
  return db.select().from(turns).where(eq(turns.debateId, id)).orderBy(asc(turns.seq));
}

describe("runStep", () => {
  it("runs a debate to completion, alternating speakers and summing tokens", async () => {
    const debateId = await startedDebate(2);
    const model = scriptedModel([
      { text: "Ada: Cars must go. ", inputTokens: 100, outputTokens: 40 },
      { text: "Cars bring customers.", inputTokens: 150, outputTokens: 30 },
      { text: "Data says otherwise.", inputTokens: 200, outputTokens: 20 },
      { text: "We'll see.", inputTokens: 250, outputTokens: 10 },
    ]);
    const opts = { resolveModel: resolverFor(model), now: clock.now };

    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      outcomes.push(await runStep(db, debateId, opts));
      clock.advance(1000);
    }

    expect(outcomes.map((o) => (o.kind === "turn" ? [o.speaker, o.debateCompleted] : o.kind))).toEqual([
      ["Ada", false],
      ["Bram", false],
      ["Ada", false],
      ["Bram", true],
    ]);
    const saved = await turnsOf(debateId);
    expect(saved.map((t) => [t.seq, t.round, t.kind, t.status, t.content])).toEqual([
      [1, 1, "opening", "complete", "Cars must go."], // name label stripped
      [2, 1, "opening", "complete", "Cars bring customers."],
      [3, 2, "closing", "complete", "Data says otherwise."],
      [4, 2, "closing", "complete", "We'll see."],
    ]);

    const d = await getDebate(debateId);
    expect(d.status).toBe("completed");
    expect(d.totalPromptTokens).toBe(700);
    expect(d.totalCompletionTokens).toBe(100);
    expect(d.votingClosesAt).toBe(d.completedAt! + VOTING_DURATIONS["3d"]);
    expect(d.lockToken).toBeNull();

    expect(await runStep(db, debateId, opts)).toEqual({ kind: "skipped" });
  });

  it("gives each speaker the debate so far, with others' turns labelled", async () => {
    const debateId = await startedDebate(2);
    const model = scriptedModel(["First point.", "Second point."]);
    await runStep(db, debateId, { resolveModel: resolverFor(model), now: clock.now });
    await runStep(db, debateId, { resolveModel: resolverFor(model), now: clock.now });

    const secondCall = model.doStreamCalls[1];
    const text = JSON.stringify(secondCall.prompt);
    expect(text).toContain("You are Bram");
    expect(text).toContain("Ada: First point.");
  });

  it("trims a turn cut off by the length cap back to its last full sentence", async () => {
    const debateId = await startedDebate(2);
    const model = scriptedModel([{ text: "One full sentence. Another full one. And a cut-off thou", finishReason: "length" }]);
    await runStep(db, debateId, { resolveModel: resolverFor(model), now: clock.now });
    expect((await turnsOf(debateId))[0].content).toBe("One full sentence. Another full one.");
  });

  it("jumps to closing statements when the token budget is used up", async () => {
    const debateId = await startedDebate(4);
    await db.update(debates).set({ maxTotalTokens: 100 }).where(eq(debates.id, debateId));
    const model = scriptedModel([{ text: "A long opening.", inputTokens: 90, outputTokens: 20 }]);
    const opts = { resolveModel: resolverFor(model), now: clock.now };

    await runStep(db, debateId, opts); // Ada's opening uses 110 tokens
    await runStep(db, debateId, opts); // over budget: Ada closes
    const saved = await turnsOf(debateId);
    expect(saved.map((t) => [t.round, t.kind])).toEqual([
      [1, "opening"],
      [4, "closing"],
    ]);
  });

  it("waits with growing delays while the model is unreachable, without failing", async () => {
    const debateId = await startedDebate(2);
    const down = { resolveModel: resolverFor(unreachableModel()), now: clock.now };

    const first = await runStep(db, debateId, down);
    expect(first).toMatchObject({ kind: "waiting", nextAttemptAt: clock.now() + waitDelayMs(1) });
    let d = await getDebate(debateId);
    expect(d).toMatchObject({ status: "running", waitingReason: WAITING_FOR_MODEL, waitAttempts: 1, lockToken: null });
    expect(await turnsOf(debateId)).toHaveLength(0);

    expect(await runStep(db, debateId, down)).toEqual({ kind: "skipped" }); // not due yet
    clock.advance(waitDelayMs(1));
    const second = await runStep(db, debateId, down);
    expect(second).toMatchObject({ kind: "waiting", nextAttemptAt: clock.now() + waitDelayMs(2) });
    expect(waitDelayMs(2)).toBe(2 * waitDelayMs(1));
    expect(waitDelayMs(20)).toBe(10 * 60_000);

    clock.advance(waitDelayMs(2));
    const back = await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel(["Back again."])), now: clock.now });
    expect(back.kind).toBe("turn");
    d = await getDebate(debateId);
    expect(d).toMatchObject({ waitingReason: null, waitAttempts: 0, nextAttemptAt: null });
  });

  it("waits on a rate limit (HTTP 429), honouring retry-after, instead of failing", async () => {
    const debateId = await startedDebate(2);
    const outcome = await runStep(db, debateId, {
      resolveModel: resolverFor(rateLimitedModel(3600)),
      now: clock.now,
    });
    expect(outcome).toMatchObject({ kind: "waiting", nextAttemptAt: clock.now() + 3600_000 });
    expect(await getDebate(debateId)).toMatchObject({ status: "running", waitingReason: RATE_LIMITED, retryCount: 0 });

    // Without retry-after, the normal growing backoff applies.
    clock.advance(3600_000);
    const again = await runStep(db, debateId, { resolveModel: resolverFor(rateLimitedModel()), now: clock.now });
    expect(again).toMatchObject({ kind: "waiting", nextAttemptAt: clock.now() + waitDelayMs(2) });
  });

  it("retries a bad (empty) turn twice, then fails the debate", async () => {
    const debateId = await startedDebate(2);
    const empty = { resolveModel: resolverFor(scriptedModel(["   "])), now: clock.now };

    for (let i = 1; i <= MAX_BAD_TURN_RETRIES; i++) {
      const outcome = await runStep(db, debateId, empty);
      expect(outcome).toMatchObject({ kind: "retrying", retryCount: i });
      clock.advance(10_000);
    }
    expect(await runStep(db, debateId, empty)).toMatchObject({ kind: "failed" });
    expect(await getDebate(debateId)).toMatchObject({ status: "failed", errorMessage: "The model returned an empty turn." });
  });

  it("says when a provider's safety filter blocked the turn", async () => {
    const debateId = await startedDebate(2);
    const blocked = { resolveModel: resolverFor(scriptedModel([{ text: "", finishReason: "content-filter" }])), now: clock.now };
    expect(await runStep(db, debateId, blocked)).toMatchObject({ kind: "retrying", error: "The model's safety filter blocked the turn." });
  });

  it("skips a debate another worker holds, but takes over an abandoned lock", async () => {
    const debateId = await startedDebate(2);
    const opts = { resolveModel: resolverFor(scriptedModel(["Hello."])), now: clock.now };
    await db.update(debates).set({ lockToken: "other", lockedAt: clock.now() }).where(eq(debates.id, debateId));
    expect(await runStep(db, debateId, opts)).toEqual({ kind: "skipped" });

    clock.advance(LOCK_TTL_MS + 1_000);
    expect((await runStep(db, debateId, opts)).kind).toBe("turn");
  });

  it("discards a half-written turn left by a crash and regenerates it", async () => {
    const debateId = await startedDebate(2);
    const [{ id: participantId }] = await db
      .select({ id: debateParticipants.id })
      .from(debateParticipants)
      .where(eq(debateParticipants.debateId, debateId))
      .orderBy(asc(debateParticipants.position));
    await db.insert(turns).values({
      id: "stale", debateId, participantId, round: 1, seq: 1, kind: "opening", status: "streaming", content: "Half a thou", createdAt: 0, updatedAt: 0,
    });

    await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel(["A fresh opening."])), now: clock.now });
    const saved = await turnsOf(debateId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ seq: 1, status: "complete", content: "A fresh opening." });
  });

  it("writes partial text while the turn streams", async () => {
    const debateId = await startedDebate(2);
    // The single connection runs queries in order, so a read queued on each chunk sees the
    // content as of the previous chunk's partial write.
    const reads: Promise<{ content: string; status: string }[]>[] = [];
    let ticks = 0;
    await runStep(db, debateId, {
      resolveModel: resolverFor(scriptedModel(["one two three four five"])),
      now: () => clock.now() + ticks++ * 1000, // every chunk crosses the write interval
      onDelta: () => {
        // .all() runs the query now; a bare builder would only run when awaited at the end.
        reads.push(db.select({ content: turns.content, status: turns.status }).from(turns).where(eq(turns.debateId, debateId)).all());
      },
    });
    const seen = (await Promise.all(reads)).map((rows) => rows[0]);
    expect(seen.some((r) => r?.status === "streaming" && r.content.length > 0)).toBe(true);
  });
});

describe("reading pace", () => {
  const TEN_WORDS = "One two three four five six seven eight nine ten.";
  /** 400 words: 80 s at 5 words a second, long enough for the next turn to be prepared ahead. */
  const LONG = Array.from({ length: 40 }, () => TEN_WORDS).join(" ");

  it("runs at full speed with pacing off", async () => {
    const debateId = await startedDebate(2);
    const outcome = await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel([TEN_WORDS])), now: clock.now, wordsPerSecond: null });
    expect(outcome).toMatchObject({ kind: "turn", nextTurnAt: null, revealEndsAt: null });
    expect((await turnsOf(debateId))[0].revealStartedAt).toBeNull();
    expect((await getDebate(debateId)).nextAttemptAt).toBeNull();
  });

  it("shows a turn at reading pace and prepares the next one shortly before it ends", async () => {
    const debateId = await startedDebate(2);
    const opts = { resolveModel: resolverFor(scriptedModel([LONG])), now: clock.now, wordsPerSecond: 5, speak: null };
    const t0 = clock.now();

    const outcome = await runStep(db, debateId, opts);
    const end = t0 + 80_000;
    const prepareAt = end + PAUSE_BETWEEN_TURNS_MS - PREPARE_AHEAD_MS;
    expect(outcome).toMatchObject({ kind: "turn", nextTurnAt: prepareAt, revealEndsAt: end, spoken: false });
    expect((await turnsOf(debateId))[0]).toMatchObject({ revealStartedAt: t0, revealEndsAt: end, audioMarks: null });
    expect((await getDebate(debateId)).nextAttemptAt).toBe(prepareAt);
    expect((await getDebate(debateId)).waitingReason).toBeNull(); // nothing is wrong: no notice

    // A message arriving early does nothing; on time, the next turn is written but held back until
    // the first has been shown, plus a pause.
    expect(await runStep(db, debateId, opts)).toEqual({ kind: "skipped" });
    clock.set(prepareAt);
    expect(await runStep(db, debateId, opts)).toMatchObject({ kind: "turn", seq: 2 });
    const second = (await turnsOf(debateId))[1];
    expect(second.revealStartedAt).toBe(end + PAUSE_BETWEEN_TURNS_MS);
    expect(second.revealEndsAt).toBe(end + PAUSE_BETWEEN_TURNS_MS + 80_000);
  });

  it("doesn't hold back the end of a debate", async () => {
    const debateId = await startedDebate(2);
    const opts = { resolveModel: resolverFor(scriptedModel([TEN_WORDS])), now: clock.now, wordsPerSecond: 5, speak: null };
    for (let i = 0; i < 3; i++) {
      expect(await runStep(db, debateId, opts)).toMatchObject({ kind: "turn", debateCompleted: false });
      clock.advance(10_000);
    }
    expect(await runStep(db, debateId, opts)).toMatchObject({ kind: "turn", debateCompleted: true, nextTurnAt: null });
    expect((await getDebate(debateId)).status).toBe("completed");
  });
});

describe("speech", () => {
  const TEXT = "Cars must go. The data is clear.";
  const marks: Mark[] = [
    [0, 0],
    [6000, TEXT.length],
  ];
  const speaking = (model = "gemini-a") => {
    const calls: SpeechRequest[] = [];
    const speak: SpeechMaker = async (request) => {
      calls.push(request);
      return { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg", durationMs: 6000, marks, model, nextModel: model };
    };
    return { speak, calls };
  };

  it("gives a turn its agent's voice and times it by the speech", async () => {
    const debateId = await startedDebate(2);
    const { speak, calls } = speaking();
    const t0 = clock.now();
    const outcome = await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel([TEXT])), now: clock.now, wordsPerSecond: 5, speak });

    expect(outcome).toMatchObject({ kind: "turn", spoken: true, revealEndsAt: t0 + Math.ceil(6000 / SPEECH_PLAYBACK_RATE) });
    const [ada] = await db.select().from(debateParticipants).where(eq(debateParticipants.debateId, debateId)).orderBy(asc(debateParticipants.position));
    expect(calls[0]).toMatchObject({ text: TEXT, voice: ada.voice, direction: ada.voiceStyle, model: null });
    const [turn] = await turnsOf(debateId);
    expect(parseMarks(turn.audioMarks)).toEqual(marks);
    const [audio] = await db.select().from(turnAudio).where(eq(turnAudio.turnId, turn.id));
    expect([...audio.data]).toEqual([1, 2, 3]);
    expect((await getDebate(debateId)).voiceModel).toBe("gemini-a");
  });

  it("keeps the debate on its voice model", async () => {
    const debateId = await startedDebate(2);
    await db.update(debates).set({ voiceModel: "gemini-b" }).where(eq(debates.id, debateId));
    const { speak, calls } = speaking("gemini-b");
    await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel([TEXT])), now: clock.now, wordsPerSecond: 5, speak });
    expect(calls[0].model).toBe("gemini-b");
  });

  it("goes ahead as text when there's no speech (Gemini down or its limits used up)", async () => {
    const debateId = await startedDebate(2);
    const speak: SpeechMaker = async () => {
      throw new Error("quota");
    };
    const outcome = await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel([TEXT])), now: clock.now, wordsPerSecond: 5, speak });
    expect(outcome).toMatchObject({ kind: "turn", spoken: false });
    expect((await turnsOf(debateId))[0].audioMarks).toBeNull();
    expect(await db.select().from(turnAudio)).toHaveLength(0);
  });

  it("deletes speech once everyone has heard it", async () => {
    const debateId = await startedDebate(2);
    const { speak } = speaking();
    const opts = { resolveModel: resolverFor(scriptedModel([TEXT])), now: clock.now, wordsPerSecond: 5, speak };
    await runStep(db, debateId, opts);
    clock.advance(10_000);
    await runStep(db, debateId, opts);
    expect(await db.select().from(turnAudio)).toHaveLength(2); // the first turn ended only just now
    clock.advance(AUDIO_KEPT_AFTER_SHOWN_MS + 10_000); // past both turns' ends
    await runStep(db, debateId, opts);
    const kept = await db.select({ turnId: turnAudio.turnId }).from(turnAudio);
    const seqs = (await turnsOf(debateId)).filter((t) => kept.some((k) => k.turnId === t.id)).map((t) => t.seq);
    expect(seqs).toEqual([3]);
  });
});

describe("rolling summary", () => {
  it("folds older turns into a summary once 12 have built up, keeping the last 6 word for word", async () => {
    await seedUser(db, "carol");
    const debateId = await createDebate(
      db,
      "alice",
      { topic: "Should cities ban cars?", rounds: 5, maxParticipants: 3, startMode: "manual" },
      clock.now(),
    );
    for (const [i, user] of ["alice", "bob", "carol"].entries()) {
      await enter(db, { debateId, userId: user, agentId: await seedAgent(db, user, { name: `Speaker${i + 1}` }), position: i + 1 });
    }
    await startDebate(db, { debateId, userId: "alice" }, clock.now());

    // Every call gets a distinct reply, so we can tell turns from the summary.
    let n = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        n += 1;
        const text = `Reply number ${n}.`;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: text },
              { type: "text-end" as const, id: "t" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 5, text: 5, reasoning: undefined },
                },
              },
            ],
          }),
        };
      },
    });
    const opts = { resolveModel: resolverFor(model), now: clock.now };

    for (let i = 0; i < 11; i++) await runStep(db, debateId, opts);
    expect((await getDebate(debateId)).summary).toBeNull();

    await runStep(db, debateId, opts); // turn 12, then the fold (call 13)
    const d = await getDebate(debateId);
    expect(d.summaryThroughSeq).toBe(6);
    expect(d.summary).toBe("Reply number 13.");

    await runStep(db, debateId, opts); // turn 13 sees the summary + turns 7-12
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain("so far, summarised");
    expect(prompt).toContain("Reply number 13.");
    expect(prompt).not.toContain("Reply number 1.");
    expect(prompt).toContain("Reply number 7.");
  });
});

describe("error classification", () => {
  it("treats connection failures, timeouts, overload and rate limits as 'wait', other errors as 'bad turn'", () => {
    expect(isModelUnreachable(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }))).toBe(true);
    expect(isModelUnreachable(Object.assign(new Error("slow"), { name: "TimeoutError" }))).toBe(true);
    expect(isModelUnreachable({ statusCode: 503, message: "overloaded" })).toBe(true);
    expect(isModelUnreachable({ statusCode: 500, message: "Internal error encountered." })).toBe(true);
    expect(isModelUnreachable({ statusCode: 429, message: "slow down" })).toBe(true);
    expect(isModelUnreachable({ statusCode: 404, message: "model 'nope' not found" })).toBe(false);
    expect(isModelUnreachable(new Error("GROQ_API_KEY is not set"))).toBe(false);
  });

  it("reads retry-after as seconds or an HTTP date, only for rate limits", () => {
    const now = 1_700_000_000_000;
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
    expect(retryAfterMs({ statusCode: 429, responseHeaders: { "Retry-After": "30" } }, now)).toBe(30_000);
    const date = new Date(now + 90_000).toUTCString();
    expect(retryAfterMs({ statusCode: 429, responseHeaders: { "retry-after": date } }, now)).toBe(90_000);
    expect(retryAfterMs({ statusCode: 429, responseHeaders: {} }, now)).toBeUndefined();
  });
});

