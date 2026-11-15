import { asc, eq, inArray } from "drizzle-orm";
import { displayNames } from "./auth/session";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates, turns } from "./db/schema";

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

export function toTurnView(t: typeof turns.$inferSelect): TurnView {
  return {
    id: t.id,
    seq: t.seq,
    round: t.round,
    kind: t.kind,
    status: t.status,
    participantId: t.participantId,
    content: t.content,
    promptTokens: t.promptTokens,
    completionTokens: t.completionTokens,
  };
}

/** Everything the debate page needs, in one place. */
export async function loadDebateView(id: string) {
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
    };
  });

  const turnRows = await db.select().from(turns).where(eq(turns.debateId, id)).orderBy(asc(turns.seq));
  return {
    debate,
    creatorName: names.get(debate.creatorId) ?? "Someone",
    slots,
    turns: turnRows.filter((t) => t.kind !== "summary").map(toTurnView),
  };
}
