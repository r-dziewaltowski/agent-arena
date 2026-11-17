import { desc, eq, inArray, ne } from "drizzle-orm";
import { avatarUrl, generatedAvatarUrl } from "./avatars";
import { displayNames } from "./auth/session";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates, reports, turns } from "./db/schema";
import { REPORT_REASONS } from "./reports-shared";

export type ReportView = {
  id: string;
  debateId: string;
  topic: string;
  target: "topic" | "turn" | "agent";
  reason: string;
  note: string | null;
  reporterName: string;
  createdAt: number;
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  /** The reported turn, for a turn report. */
  turn: { seq: number; speaker: string; text: string; removed: boolean } | null;
  /** The reported agent, for an agent report. */
  agent: { name: string; agentId: string | null; avatarUrl: string; hasUpload: boolean } | null;
};

/** Open reports (oldest first, the order to work through them) and the most recently closed ones. */
export async function loadReports(): Promise<{ open: ReportView[]; closed: ReportView[] }> {
  const db = await getDb();
  const open = await db.select().from(reports).where(eq(reports.status, "open")).orderBy(reports.createdAt);
  const closed = await db.select().from(reports).where(ne(reports.status, "open")).orderBy(desc(reports.resolvedAt)).limit(20);
  const all = [...open, ...closed];

  const ids = <T,>(values: (T | null)[]) => [...new Set(values.filter((v): v is T => v !== null))];
  const debateIds = ids(all.map((r) => r.debateId));
  const turnIds = ids(all.map((r) => r.turnId));
  const entryIds = ids(all.map((r) => r.participantId));

  const debateRows = debateIds.length ? await db.select({ id: debates.id, topic: debates.topic }).from(debates).where(inArray(debates.id, debateIds)) : [];
  const turnRows = turnIds.length
    ? await db
        .select({ id: turns.id, seq: turns.seq, content: turns.content, removedAt: turns.removedAt, speaker: debateParticipants.name })
        .from(turns)
        .leftJoin(debateParticipants, eq(debateParticipants.id, turns.participantId))
        .where(inArray(turns.id, turnIds))
    : [];
  const entryRows = entryIds.length
    ? await db
        .select({
          id: debateParticipants.id,
          name: debateParticipants.name,
          agentId: debateParticipants.agentId,
          agentName: agents.name,
          imageUpdatedAt: agents.imageUpdatedAt,
          avatarSeed: agents.avatarSeed,
        })
        .from(debateParticipants)
        .leftJoin(agents, eq(agents.id, debateParticipants.agentId))
        .where(inArray(debateParticipants.id, entryIds))
    : [];
  const names = await displayNames(all.map((r) => r.reporterId));

  const topicOf = new Map(debateRows.map((d) => [d.id, d.topic]));
  const turnOf = new Map(turnRows.map((t) => [t.id, t]));
  const entryOf = new Map(entryRows.map((e) => [e.id, e]));
  const view = (r: (typeof all)[number]): ReportView => {
    const turn = r.turnId ? turnOf.get(r.turnId) : undefined;
    const entry = r.participantId ? entryOf.get(r.participantId) : undefined;
    return {
      id: r.id,
      debateId: r.debateId,
      topic: topicOf.get(r.debateId) ?? "(deleted debate)",
      target: r.target,
      reason: REPORT_REASONS[r.reason],
      note: r.note,
      reporterName: names.get(r.reporterId) ?? "Someone",
      createdAt: r.createdAt,
      status: r.status,
      resolution: r.resolution,
      turn: turn ? { seq: turn.seq, speaker: turn.speaker ?? "an agent", text: turn.content, removed: turn.removedAt !== null } : null,
      agent: entry
        ? {
            name: entry.agentName ?? entry.name ?? "Deleted agent",
            agentId: entry.agentId,
            avatarUrl: entry.agentId ? avatarUrl({ id: entry.agentId, imageUpdatedAt: entry.imageUpdatedAt, avatarSeed: entry.avatarSeed }) : generatedAvatarUrl(entry.id),
            hasUpload: !!entry.imageUpdatedAt,
          }
        : null,
    };
  };
  return { open: open.map(view), closed: closed.map(view) };
}
