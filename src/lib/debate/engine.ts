import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import {
  callSettings,
  resolveModel as defaultResolveModel,
  type ModelResolver,
  type Provider,
} from "../ai/provider";
import type { Db } from "../db/client";
import { debateParticipants, debates, turns } from "../db/schema";
import { publishChunk } from "./broadcast";
import { votingClosesAtFor } from "./lifecycle";
import { buildPrompt, cleanTurnText, trimToLastSentence, turnKindFor, type Speaker } from "./prompt";
import { maybeFoldSummary } from "./summarize";

/** A lock older than this is considered abandoned (e.g. the worker crashed). */
export const LOCK_TTL_MS = 90_000;
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
  | { kind: "turn"; turnId: string; seq: number; speaker: string; text: string; debateCompleted: boolean }
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

    const speakerRow = participants[turnIndex];
    if (!speakerRow) throw new Error(`No participant at index ${turnIndex}.`);
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

    // Generate.
    let streamError: unknown;
    let text = "";
    let usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined;
    let finishReason: string | undefined;
    const started = now();
    try {
      const provider = speakerRow.provider as Provider;
      const model = resolve(provider, speakerRow.modelId ?? "");
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
      const error = streamError ? describeError(streamError) : "The model returned an empty turn.";

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
    let nextIndex = turnIndex + 1;
    let nextRound = round;
    if (nextIndex >= participants.length) {
      nextIndex = 0;
      nextRound = round + 1;
    }
    const completed = nextRound > debate.rounds;
    const finishedAt = now();

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
          updatedAt: finishedAt,
        })
        .where(eq(turns.id, turnId!));
      await tx
        .update(debates)
        .set({
          currentRound: completed ? debate.rounds : nextRound,
          currentTurnIndex: completed ? 0 : nextIndex,
          totalPromptTokens: debate.totalPromptTokens + promptTokens,
          totalCompletionTokens: debate.totalCompletionTokens + completionTokens,
          retryCount: 0,
          waitAttempts: 0,
          nextAttemptAt: null,
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

    // Long debates: fold older turns into the rolling summary (still holding the lock).
    if (!completed) {
      await maybeFoldSummary(db, debateId, {
        resolveModel: resolve,
        provider: speakerRow.provider as Provider,
        modelId: speakerRow.modelId ?? "",
      });
    }

    return { kind: "turn", turnId: turnId!, seq, speaker: speaker.name, text: cleaned, debateCompleted: completed };
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
  };
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
    if (typeof e.statusCode === "number" && [502, 503, 504].includes(e.statusCode)) return true;
    const haystack = `${e.code ?? ""} ${e.message ?? String(e)}`;
    if (patterns.some((p) => p.test(haystack))) return true;
  }
  return false;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
