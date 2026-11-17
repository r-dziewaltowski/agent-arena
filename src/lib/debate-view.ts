import { asc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { displayNames } from "./auth/session";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates, turns, votes } from "./db/schema";
import { readingWordsPerSecond, revealedLength } from "./debate/pacing";

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
};

export type TurnView = {
  id: string;
  seq: number;
  round: number;
  kind: string;
  status: "streaming" | "complete";
  participantId: string | null;
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

/**
 * A turn as viewers see it `now`: a turn being revealed at reading pace (see `pacing.ts`) shows
 * only its words so far and counts as still being written until they're all out.
 */
export function toTurnView(
  t: typeof turns.$inferSelect,
  now = Date.now(),
  wordsPerSecond: number | null = readingWordsPerSecond(),
): TurnView {
  const visible = revealedLength(t.content, t.revealStartedAt, now, wordsPerSecond);
  const revealing = visible < t.content.length;
  return {
    id: t.id,
    seq: t.seq,
    round: t.round,
    kind: t.kind,
    status: revealing ? "streaming" : t.status,
    participantId: t.participantId,
    content: revealing ? t.content.slice(0, visible) : t.content,
    promptTokens: revealing ? null : t.promptTokens,
    completionTokens: revealing ? null : t.completionTokens,
  };
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
    };
  });

  const turnRows = await db.select().from(turns).where(eq(turns.debateId, id)).orderBy(asc(turns.seq));
  const voteRows = await db
    .select({ participantId: votes.participantId, userId: votes.userId })
    .from(votes)
    .where(eq(votes.debateId, id));
  return {
    debate,
    creatorName: names.get(debate.creatorId) ?? "Someone",
    slots,
    turns: turnRows.filter((t) => t.kind !== "summary").map((t) => toTurnView(t)),
    votes: voteRows,
    /** When this view was loaded (decides whether voting is still open). */
    loadedAt: Date.now(),
  };
}
