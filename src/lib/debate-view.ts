import { asc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { displayNames } from "./auth/session";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates, turns, votes } from "./db/schema";
import { readingWordsPerSecond, revealedLength } from "./debate/pacing";
import { avatarUrl, generatedAvatarUrl } from "./avatars";
import { parseMarks, type Mark } from "./voice/marks";
import { defaultSpeechMaker } from "./voice/speech";

export type DebateRow = typeof debates.$inferSelect;

export type SlotEntry = {
  participantId: string;
  position: number;
  userId: string;
  ownerName: string;
  agentId: string | null;
  /** Snapshot name once started; the live agent's name while open. */
  name: string;
  provider: string | null;
  modelId: string | null;
  modelFallbackFrom: string | null;
  /** Why this agent can't speak any more (its owner's paid-model key stopped working), if so. */
  silencedReason: string | null;
  /** The agent's picture (its current one); a generated face once the agent is deleted. */
  avatarUrl: string;
};

/** What a browser needs to reveal a turn itself, in step with its speech when listening. */
export type RevealView = {
  startsAt: number;
  /** The whole turn: the browser cuts it to what's due, by the clock or by the audio. */
  full: string;
  marks: Mark[] | null;
  /** The turn's speech while it's being shown, if it has any. */
  audioUrl: string | null;
};

export type TurnView = {
  id: string;
  seq: number;
  round: number;
  kind: string;
  status: "streaming" | "complete";
  participantId: string | null;
  /** What should be visible now (all of it once complete). */
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Set while the turn is being shown. */
  reveal: RevealView | null;
  /** An admin removed its text after a report. */
  removed: boolean;
};

/** A turn that's ready but not shown yet (the previous one is still going): its speech can preload. */
export type UpcomingTurn = { seq: number; startsAt: number; audioUrl: string | null };

export function turnAudioUrl(debateId: string, turnId: string): string {
  return `/api/debates/${debateId}/turns/${turnId}/audio`;
}

/** Turns prepared ahead or still being written, which viewers don't get yet. */
function isHidden(t: typeof turns.$inferSelect, now: number, wordsPerSecond: number | null): boolean {
  if (t.revealStartedAt !== null) return t.revealStartedAt > now;
  // With pacing on, a turn is shown only once written (and spoken); without it, as it's written.
  return t.status === "streaming" && wordsPerSecond !== null;
}

/**
 * A turn as viewers see it `now`, or null if they don't get it yet. A turn being revealed (see
 * `pacing.ts`) shows only its words so far and counts as still being written until they're all out.
 */
export function toTurnView(
  t: typeof turns.$inferSelect,
  now = Date.now(),
  wordsPerSecond: number | null = readingWordsPerSecond(),
): TurnView | null {
  if (isHidden(t, now, wordsPerSecond)) return null;
  if (t.removedAt !== null) {
    const { id, seq, round, kind, participantId } = t;
    return { id, seq, round, kind, participantId, status: "complete", content: "", promptTokens: null, completionTokens: null, reveal: null, removed: true };
  }
  const marks = parseMarks(t.audioMarks);
  const visible = revealedLength(t.content, { revealStartedAt: t.revealStartedAt, marks }, now, wordsPerSecond);
  const revealing = visible < t.content.length && t.revealStartedAt !== null;
  return {
    id: t.id,
    seq: t.seq,
    round: t.round,
    kind: t.kind,
    status: revealing || t.status === "streaming" ? "streaming" : "complete",
    participantId: t.participantId,
    content: t.content.slice(0, visible),
    promptTokens: revealing ? null : t.promptTokens,
    completionTokens: revealing ? null : t.completionTokens,
    reveal: revealing
      ? { startsAt: t.revealStartedAt!, full: t.content, marks, audioUrl: marks ? turnAudioUrl(t.debateId, t.id) : null }
      : null,
    removed: false,
  };
}

/** The visible turns of a debate `now`, and the next one if it's ready but not shown yet. */
export function viewTurns(
  rows: (typeof turns.$inferSelect)[],
  now = Date.now(),
  wordsPerSecond: number | null = readingWordsPerSecond(),
): { turns: TurnView[]; upcoming: UpcomingTurn | null } {
  const spoken = rows.filter((t) => t.kind !== "summary");
  const visible = spoken.map((t) => toTurnView(t, now, wordsPerSecond)).filter((t): t is TurnView => t !== null);
  const next = spoken.find((t) => t.status === "complete" && t.revealStartedAt !== null && t.revealStartedAt > now);
  const upcoming = next
    ? { seq: next.seq, startsAt: next.revealStartedAt!, audioUrl: next.audioMarks ? turnAudioUrl(next.debateId, next.id) : null }
    : null;
  return { turns: visible, upcoming };
}

/** Everything the debate page needs, in one place. */
export async function loadDebateView(id: string) {
  // Per-request data (votes, the current time for the voting window): never prerender it.
  await connection();
  const db = await getDb();
  const [debate] = await db.select().from(debates).where(eq(debates.id, id));
  if (!debate) return null;

  const entries = await db
    .select()
    .from(debateParticipants)
    .where(eq(debateParticipants.debateId, id))
    .orderBy(asc(debateParticipants.position));
  const agentIds = entries.map((e) => e.agentId).filter((x): x is string => !!x);
  const agentRows = agentIds.length ? await db.select().from(agents).where(inArray(agents.id, agentIds)) : [];
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const names = await displayNames([debate.creatorId, ...entries.map((e) => e.userId)]);

  const slots: SlotEntry[] = entries.map((e) => {
    const agent = e.agentId ? agentById.get(e.agentId) : undefined;
    return {
      participantId: e.id,
      position: e.position,
      userId: e.userId,
      ownerName: names.get(e.userId) ?? "Someone",
      agentId: e.agentId,
      name: e.name ?? agent?.name ?? "Deleted agent",
      provider: e.provider ?? agent?.provider ?? null,
      modelId: e.modelId ?? agent?.modelId ?? null,
      modelFallbackFrom: e.modelFallbackFrom,
      silencedReason: e.silencedAt ? (e.silencedReason ?? "its owner's key stopped working") : null,
      avatarUrl: agent ? avatarUrl(agent) : generatedAvatarUrl(e.id),
    };
  });

  const turnRows = await db.select().from(turns).where(eq(turns.debateId, id)).orderBy(asc(turns.seq));
  const voteRows = await db
    .select({ participantId: votes.participantId, userId: votes.userId })
    .from(votes)
    .where(eq(votes.debateId, id));
  const loadedAt = Date.now();
  const wordsPerSecond = readingWordsPerSecond();
  const { turns: visibleTurns, upcoming } = viewTurns(turnRows, loadedAt, wordsPerSecond);
  return {
    debate,
    creatorName: names.get(debate.creatorId) ?? "Someone",
    slots,
    turns: visibleTurns,
    /** A turn that's ready but not shown yet: the debate is still going for viewers. */
    upcoming,
    wordsPerSecond,
    /** Whether turns get speech (the Listen button). */
    voiceOn: defaultSpeechMaker() !== null && wordsPerSecond !== null,
    votes: voteRows,
    /** When this view was loaded (decides whether voting is still open; the browser's clock offset). */
    loadedAt,
  };
}
