import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import {
  callSettings,
  freeSummaryModel,
  resolveModel as defaultResolveModel,
  type ModelResolver,
  type Provider,
} from "../ai/provider";
import type { Db } from "../db/client";
import { debateParticipants, debates, turnAudio, turns } from "../db/schema";
import { keyRefusalReason, loadKey, markKeyFailed, markKeyUsed, NOT_CONNECTED_REASON } from "../openrouter";
import { deleteHeardAudio } from "../voice/cleanup";
import { defaultSpeechMaker, type Speech, type SpeechMaker } from "../voice/speech";
import { voiceFor } from "../voice/voices";
import type { Creativity } from "./traits";
import { publishChunk } from "./broadcast";
import { votingClosesAtFor } from "./lifecycle";
import { buildPrompt, cleanTurnText, trimToLastSentence, turnKindFor, type Speaker } from "./prompt";
import { nextPrepareAt, PAUSE_BETWEEN_TURNS_MS, readingWordsPerSecond, revealDurationMs, turnRevealEndsAt } from "./pacing";
import { maybeFoldSummary } from "./summarize";

/**
 * A lock older than this is considered abandoned (e.g. the function was killed mid-turn). Covers a
 * slow model's first words (up to 2 min with a cold local Ollama) plus making the turn's speech.
 */
export const LOCK_TTL_MS = 180_000;
/** Bad turns are retried this many times before the debate fails. */
export const MAX_BAD_TURN_RETRIES = 2;
const BAD_TURN_RETRY_DELAY_MS = 5_000;
const WAIT_BASE_MS = 30_000;
const WAIT_MAX_MS = 10 * 60_000;
export const WAITING_FOR_MODEL = "Waiting for the model to become available.";
export const RATE_LIMITED = "The model's free usage limit was reached; waiting until it resets.";
/** Longest wait honoured from a provider's retry-after (daily limits can reset hours later). */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

export type StepOutcome =
  | { kind: "skipped" }
  /**
   * `nextTurnAt`: when to prepare the next turn (shortly before viewers reach the end of this one),
   * or null for now. `revealEndsAt`: when this turn will have been shown. `spoken`: it has speech.
   */
  | {
      kind: "turn";
      turnId: string;
      seq: number;
      speaker: string;
      text: string;
      debateCompleted: boolean;
      nextTurnAt: number | null;
      revealEndsAt: number | null;
      spoken: boolean;
    }
  /** The speaker's owner's paid-model key stopped working: that agent is skipped from now on. */
  | { kind: "silenced"; speaker: string; reason: string }
  /** Only silenced agents were left to speak, so the debate ended. */
  | { kind: "completed" }
  | { kind: "waiting"; error: string; nextAttemptAt: number }
  | { kind: "retrying"; error: string; retryCount: number }
  | { kind: "failed"; error: string };

export type StepOptions = {
  resolveModel?: ModelResolver;
  now?: () => number;
  /** Called with each text chunk as the model writes it. */
  onDelta?: (delta: string) => void;
  /** Called once the speaker is known, before the model is asked. */
  onTurnStart?: (info: { speaker: string; round: number; rounds: number; kind: string; seq: number }) => void;
  partialWriteIntervalMs?: number;
  /** Ollama can take 10-20 s to load a model, so the first chunk gets a long allowance. */
  firstChunkTimeoutMs?: number;
  chunkTimeoutMs?: number;
  /** Reading pace (see `pacing.ts`); null for none. Defaults to the configured pace. */
  wordsPerSecond?: number | null;
  /** Makes a turn's speech; null for none. Defaults to Gemini when configured. Only with pacing. */
  speak?: SpeechMaker | null;
};

/** Delay before the next attempt after `attempts` consecutive "model unreachable" errors. */
export function waitDelayMs(attempts: number): number {
  return Math.min(WAIT_BASE_MS * 2 ** Math.max(0, attempts - 1), WAIT_MAX_MS);
}

/**
 * Generates exactly one turn of a running debate: picks the speaker, streams the model's reply into
 * a `streaming` turn row, then saves it and advances the debate. Safe to call from any process; a
 * lock ensures only one caller works on a debate at a time.
 */
export async function runStep(db: Db, debateId: string, opts: StepOptions = {}): Promise<StepOutcome> {
  const now = opts.now ?? Date.now;
  const resolve = opts.resolveModel ?? defaultResolveModel;
  const lockToken = randomUUID();
  const t0 = now();

  const [debate] = await db
    .update(debates)
    .set({ lockToken, lockedAt: t0 })
    .where(
      and(
        eq(debates.id, debateId),
        eq(debates.status, "running"),
        or(isNull(debates.lockToken), lt(debates.lockedAt, t0 - LOCK_TTL_MS)),
        or(isNull(debates.nextAttemptAt), lte(debates.nextAttemptAt, t0)),
      ),
    )
    .returning();
  if (!debate) return { kind: "skipped" };

  let turnId: string | null = null;
  try {
    const participants = await db
      .select()
      .from(debateParticipants)
      .where(eq(debateParticipants.debateId, debateId))
      .orderBy(asc(debateParticipants.position));

    // Any streaming row is left over from a crash: we hold the lock, so nobody else is writing it.
    await db.delete(turns).where(and(eq(turns.debateId, debateId), eq(turns.status, "streaming")));
    await deleteHeardAudio(db, t0);
    const done = await db.select().from(turns).where(eq(turns.debateId, debateId)).orderBy(asc(turns.seq));

    let round = debate.currentRound;
    let turnIndex = debate.currentTurnIndex;
    const used = debate.totalPromptTokens + debate.totalCompletionTokens;
    if (debate.maxTotalTokens !== null && used >= debate.maxTotalTokens && round < debate.rounds) {
      // Over budget: skip straight to closing statements.
      round = debate.rounds;
      turnIndex = 0;
      await db.update(debates).set({ currentRound: round, currentTurnIndex: turnIndex }).where(eq(debates.id, debateId));
    }

    // Agents whose owner's paid-model key stopped working are skipped; the debate carries on.
    if (participants.length > 0 && participants.every((p) => p.silencedAt !== null)) {
      const error = `No agent can speak any more: ${participants[0].silencedReason ?? "their owners' keys stopped working"}.`;
      await db
        .update(debates)
        .set({ status: "failed", errorMessage: error, waitingReason: null, nextAttemptAt: null })
        .where(eq(debates.id, debateId));
      return { kind: "failed", error };
    }
    if (participants[turnIndex]?.silencedAt) {
      while (participants[turnIndex]?.silencedAt && round <= debate.rounds) {
        turnIndex++;
        if (turnIndex >= participants.length) {
          turnIndex = 0;
          round++;
        }
      }
      if (round > debate.rounds) {
        const finishedAt = now();
        await db
          .update(debates)
          .set({
            status: "completed",
            currentRound: debate.rounds,
            currentTurnIndex: 0,
            completedAt: finishedAt,
            votingClosesAt: votingClosesAtFor(finishedAt, debate.votingDuration),
            retryCount: 0,
            waitAttempts: 0,
            nextAttemptAt: null,
            waitingReason: null,
          })
          .where(eq(debates.id, debateId));
        return { kind: "completed" };
      }
      await db.update(debates).set({ currentRound: round, currentTurnIndex: turnIndex }).where(eq(debates.id, debateId));
    }

    const speakerRow = participants[turnIndex];
    if (!speakerRow) throw new Error(`No participant at index ${turnIndex}.`);
    const provider = speakerRow.provider as Provider;

    // Paid models run on the owner's own OpenRouter key, looked up at call time.
    let apiKey: string | undefined;
    if (provider === "openrouter") {
      apiKey = (await loadKey(db, speakerRow.userId)) ?? undefined;
      if (!apiKey) return silence(db, speakerRow, NOT_CONNECTED_REASON, now());
    }
    const speakers: Speaker[] = participants.map(toSpeaker);
    const speaker = speakers[turnIndex];
    const kind = turnKindFor(round, debate.rounds);
    const visibleTurns = done.filter(
      (t) => t.kind !== "summary" && (!debate.summary || t.seq > debate.summaryThroughSeq),
    );

    const prompt = buildPrompt({
      topic: debate.topic,
      rounds: debate.rounds,
      round,
      kind,
      speaker,
      participants: speakers,
      turns: visibleTurns.map((t) => ({ participantId: t.participantId, content: t.content })),
      summary: debate.summary,
      othersSpokeThisRound: done.some((t) => t.round === round && t.kind !== "summary"),
      maxOutputTokens: speakerRow.maxOutputTokens ?? undefined,
    });

    const seq = (done.at(-1)?.seq ?? 0) + 1;
    turnId = randomUUID();
    await db.insert(turns).values({
      id: turnId,
      debateId,
      participantId: speakerRow.id,
      round,
      seq,
      kind,
      status: "streaming",
      content: "",
      modelId: speakerRow.modelId,
      createdAt: now(),
      updatedAt: now(),
    });
    opts.onTurnStart?.({ speaker: speaker.name, round, rounds: debate.rounds, kind, seq });

    // Viewers get the turn once it's written and spoken, at the pace of its speech or reading (pacing.ts).
    const pace = opts.wordsPerSecond === undefined ? readingWordsPerSecond() : opts.wordsPerSecond;

    // Generate.
    let streamError: unknown;
    let text = "";
    let usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined;
    let finishReason: string | undefined;
    const started = now();
    try {
      const model = resolve(provider, speakerRow.modelId ?? "", { apiKey });
      const result = streamText({
        model,
        system: prompt.system,
        messages: prompt.messages,
        ...callSettings(provider, speakerRow.modelId ?? "", {
          temperature: speakerRow.temperature ?? undefined,
          maxOutputTokens: speakerRow.maxOutputTokens ?? undefined,
          stopSequences: prompt.stopSequences,
        }),
        maxRetries: 0,
        timeout: {
          firstChunkMs: opts.firstChunkTimeoutMs ?? 120_000,
          chunkMs: opts.chunkTimeoutMs ?? 60_000,
        },
        onError: ({ error }) => {
          streamError ??= error;
        },
      });

      const interval = opts.partialWriteIntervalMs ?? 300;
      let lastWrite = now();
      for await (const delta of result.textStream) {
        text += delta;
        opts.onDelta?.(delta);
        publishChunk(debateId, delta);
        if (now() - lastWrite >= interval) {
          await db.update(turns).set({ content: text, updatedAt: now() }).where(eq(turns.id, turnId));
          lastWrite = now();
        }
      }
      if (!streamError) {
        usage = await result.usage;
        finishReason = await result.finishReason;
      }
    } catch (err) {
      streamError ??= err;
    }

    let cleaned = cleanTurnText(text, speaker.name);
    if (finishReason === "length") cleaned = trimToLastSentence(cleaned);
    if (streamError || cleaned.length === 0) {
      await db.delete(turns).where(eq(turns.id, turnId));
      turnId = null;
      const error = streamError
        ? describeError(streamError)
        : finishReason === "content-filter"
          ? "The model's safety filter blocked the turn."
          : "The model returned an empty turn.";

      const refusal = provider === "openrouter" && streamError ? keyRefusalReason(streamError, now()) : null;
      if (refusal) {
        await markKeyFailed(db, speakerRow.userId, refusal, now());
        return silence(db, speakerRow, refusal, now());
      }

      // The app's own free models (Groq, Google) share one daily limit across all users. Once it's
      // used up for the day, skip this agent so agents on other quotas (e.g. paid ones) carry on;
      // if nobody else could speak, wait for the reset as before.
      if (streamError && isAppProvided(provider) && sharedDailyLimitReached(streamError, now())) {
        const othersCanSpeak = participants.some(
          (p) => p.id !== speakerRow.id && !p.silencedAt && quotaKey(p) !== quotaKey(speakerRow),
        );
        if (othersCanSpeak) return silence(db, speakerRow, `Agent Arena's free ${APP_PROVIDER_NAMES[provider]} limit is used up for today`, now());
      }

      if (streamError && isModelUnreachable(streamError)) {
        const attempts = debate.waitAttempts + 1;
        const limited = isRateLimited(streamError);
        const delay = Math.max(waitDelayMs(attempts), limited ? (retryAfterMs(streamError) ?? 0) : 0);
        const nextAttemptAt = now() + delay;
        await db
          .update(debates)
          .set({ waitAttempts: attempts, nextAttemptAt, waitingReason: limited ? RATE_LIMITED : WAITING_FOR_MODEL })
          .where(eq(debates.id, debateId));
        return { kind: "waiting", error, nextAttemptAt };
      }

      const retryCount = debate.retryCount + 1;
      if (retryCount > MAX_BAD_TURN_RETRIES) {
        await db
          .update(debates)
          .set({ status: "failed", errorMessage: error, retryCount, waitingReason: null, nextAttemptAt: null })
          .where(eq(debates.id, debateId));
        return { kind: "failed", error };
      }
      await db
        .update(debates)
        .set({ retryCount, nextAttemptAt: now() + BAD_TURN_RETRY_DELAY_MS, waitingReason: null })
        .where(eq(debates.id, debateId));
      return { kind: "retrying", error, retryCount };
    }

    // Save the turn and advance.
    const promptTokens = usage?.inputTokens ?? estimateTokens(prompt.system + JSON.stringify(prompt.messages));
    const completionTokens = usage?.outputTokens ?? estimateTokens(cleaned);
    // The next speaker, skipping silenced agents, so a debate ends as soon as nobody else can speak.
    let nextIndex = turnIndex;
    let nextRound = round;
    do {
      nextIndex++;
      if (nextIndex >= participants.length) {
        nextIndex = 0;
        nextRound++;
      }
    } while (participants[nextIndex]?.silencedAt && nextRound <= debate.rounds);
    const completed = nextRound > debate.rounds;

    // The turn's speech, when voices are on. Without it (Gemini down, its daily limit reached) the
    // turn is shown as text at reading pace: a debate never waits for its voice.
    const speak = pace === null ? null : opts.speak === undefined ? defaultSpeechMaker() : opts.speak;
    let speech: Speech | null = null;
    if (speak) {
      try {
        speech = await speak({
          text: cleaned,
          voice: voiceFor(speakerRow.agentId ?? speakerRow.id, speakerRow.voice),
          direction: speakerRow.voiceStyle ?? "",
          model: debate.voiceModel,
        });
      } catch (err) {
        console.warn(`Debate ${debateId}, turn ${seq}: no speech, shown as text only. ${describeError(err)}`);
      }
    }

    // Viewers get it once the previous turn has been shown, after a short pause.
    const finishedAt = now();
    const previous = done.filter((t) => t.kind !== "summary").at(-1);
    const previousEnd = previous ? turnRevealEndsAt(previous, pace) : null;
    const revealStartedAt = pace === null ? null : Math.max(finishedAt, previousEnd === null ? 0 : previousEnd + PAUSE_BETWEEN_TURNS_MS);
    const marks = speech?.marks ?? null;
    const revealEndsAt = revealStartedAt === null || pace === null ? null : revealStartedAt + revealDurationMs(cleaned, pace, marks);
    const nextAt = completed ? null : nextPrepareAt(revealEndsAt, finishedAt);

    await db.transaction(async (tx) => {
      await tx
        .update(turns)
        .set({
          status: "complete",
          content: cleaned,
          promptTokens,
          completionTokens,
          latencyMs: finishedAt - started,
          finishReason: finishReason ?? null,
          revealStartedAt,
          revealEndsAt,
          audioMarks: marks ? JSON.stringify(marks) : null,
          updatedAt: finishedAt,
        })
        .where(eq(turns.id, turnId!));
      if (speech) {
        await tx.insert(turnAudio).values({
          turnId: turnId!,
          debateId,
          mimeType: speech.mimeType,
          data: Buffer.from(speech.audio),
          createdAt: finishedAt,
        });
      }
      await tx
        .update(debates)
        .set({
          currentRound: completed ? debate.rounds : nextRound,
          currentTurnIndex: completed ? 0 : nextIndex,
          totalPromptTokens: debate.totalPromptTokens + promptTokens,
          totalCompletionTokens: debate.totalCompletionTokens + completionTokens,
          retryCount: 0,
          waitAttempts: 0,
          voiceModel: speech?.nextModel ?? debate.voiceModel,
          // The next turn is prepared shortly before this one has been shown (no notice: nothing is wrong).
          nextAttemptAt: nextAt,
          waitingReason: null,
          ...(completed
            ? {
                status: "completed" as const,
                completedAt: finishedAt,
                votingClosesAt: votingClosesAtFor(finishedAt, debate.votingDuration),
              }
            : {}),
        })
        .where(and(eq(debates.id, debateId), eq(debates.lockToken, lockToken)));
    });

    if (provider === "openrouter") await markKeyUsed(db, speakerRow.userId, now());

    // Long debates: fold older turns into the rolling summary (still holding the lock). The summary
    // serves everyone, so it never runs on one owner's paid key: a free model writes it instead.
    const summarizer = provider === "openrouter" ? freeSummaryModel() : { provider, modelId: speakerRow.modelId ?? "" };
    if (!completed && summarizer) {
      await maybeFoldSummary(db, debateId, { resolveModel: resolve, ...summarizer });
    }

    return {
      kind: "turn",
      turnId: turnId!,
      seq,
      speaker: speaker.name,
      text: cleaned,
      debateCompleted: completed,
      nextTurnAt: nextAt,
      revealEndsAt,
      spoken: speech !== null,
    };
  } finally {
    await db
      .update(debates)
      .set({ lockToken: null, lockedAt: null })
      .where(and(eq(debates.id, debateId), eq(debates.lockToken, lockToken)));
  }
}

function toSpeaker(p: typeof debateParticipants.$inferSelect): Speaker {
  return {
    id: p.id,
    name: p.name ?? "Unknown",
    persona: p.persona ?? "",
    style: p.style ?? "analytical",
    tone: p.tone ?? "formal",
    stance: p.stance ?? "neutral",
    // A model that takes no temperature gets its Creativity in words instead.
    creativityInPrompt: p.temperature === null && p.creativity ? (p.creativity as Creativity) : undefined,
  };
}

/** Providers whose free quota belongs to the app and is shared by every user. */
const APP_PROVIDER_NAMES: Partial<Record<Provider, string>> = { groq: "Groq", google: "Google" };

function isAppProvided(provider: Provider): boolean {
  return provider in APP_PROVIDER_NAMES;
}

/** A retry-after this far away is a daily limit, not a per-minute one. */
const DAILY_LIMIT_THRESHOLD_MS = 10 * 60_000;

export function sharedDailyLimitReached(err: unknown, now = Date.now()): boolean {
  return isRateLimited(err) && (retryAfterMs(err, now) ?? 0) > DAILY_LIMIT_THRESHOLD_MS;
}

/**
 * Which quota a participant's turns count against: the app's free models have a limit per model;
 * OpenRouter models use their owner's own account.
 */
function quotaKey(p: typeof debateParticipants.$inferSelect): string {
  return p.provider === "openrouter" ? `openrouter:${p.userId}` : `${p.provider}:${p.modelId}`;
}

/** Marks the participant as unable to speak; the next step skips it. */
async function silence(
  db: Db,
  participant: typeof debateParticipants.$inferSelect,
  reason: string,
  at: number,
): Promise<StepOutcome> {
  await db.update(debateParticipants).set({ silencedAt: at, silencedReason: reason }).where(eq(debateParticipants.id, participant.id));
  return { kind: "silenced", speaker: participant.name ?? "Unknown", reason };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type ErrorLike = {
  name?: string;
  code?: string;
  message?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  cause?: unknown;
};

function* errorChain(err: unknown): Generator<ErrorLike> {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e && !seen.has(e); e = (e as ErrorLike).cause) {
    seen.add(e);
    yield e as ErrorLike;
  }
}

/** True for HTTP 429: a provider's rate or usage limit. */
export function isRateLimited(err: unknown): boolean {
  for (const e of errorChain(err)) if (e.statusCode === 429) return true;
  return false;
}

/** The provider's suggested wait from a `retry-after` header (seconds or an HTTP date), if any. */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  for (const e of errorChain(err)) {
    const headers = e.responseHeaders;
    if (!headers) continue;
    const raw = Object.entries(headers).find(([k]) => k.toLowerCase() === "retry-after")?.[1];
    if (!raw) continue;
    const seconds = Number(raw);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

/**
 * True for errors meaning the model can't be used right now (unreachable, overloaded or
 * rate-limited) as opposed to a bad reply. These make the debate wait instead of failing.
 */
export function isModelUnreachable(err: unknown): boolean {
  if (isRateLimited(err)) return true;
  const patterns = [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /EAI_AGAIN/i,
    /ETIMEDOUT/i,
    /fetch failed/i,
    /failed to fetch/i,
    /socket hang up/i,
    /timed? ?out/i,
    /aborted/i,
  ];
  for (const e of errorChain(err)) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return true;
    // 500 too: Google answers "Internal error" for a busy model, which clears up on its own.
    if (typeof e.statusCode === "number" && [500, 502, 503, 504].includes(e.statusCode)) return true;
    const haystack = `${e.code ?? ""} ${e.message ?? String(e)}`;
    if (patterns.some((p) => p.test(haystack))) return true;
  }
  return false;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
