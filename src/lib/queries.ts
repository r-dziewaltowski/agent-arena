import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates } from "./db/schema";

/** Read helpers shared by pages. Writes go through lifecycle.ts and the server actions. */

export async function agentsOf(ownerId: string) {
  const db = await getDb();
  return db.select().from(agents).where(eq(agents.ownerId, ownerId)).orderBy(desc(agents.updatedAt));
}

export async function getAgent(id: string) {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  return agent;
}

/** How many running debates an agent is in (for the "will finish with this version" note). */
export async function runningDebateCount(agentId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: debates.id })
    .from(debateParticipants)
    .innerJoin(debates, eq(debates.id, debateParticipants.debateId))
    .where(and(eq(debateParticipants.agentId, agentId), eq(debates.status, "running")));
  return rows.length;
}

/** Debates an agent took part in or has entered, newest first. */
export async function debatesOfAgent(agentId: string) {
  const db = await getDb();
  return db
    .select({ id: debates.id, topic: debates.topic, status: debates.status, createdAt: debates.createdAt })
    .from(debateParticipants)
    .innerJoin(debates, eq(debates.id, debateParticipants.debateId))
    .where(eq(debateParticipants.agentId, agentId))
    .orderBy(desc(debates.createdAt));
}

export type DebateFilter = "all" | "open" | "running" | "completed" | "mine";

export async function listDebates(filter: DebateFilter, userId: string) {
  const db = await getDb();
  const base = db.select().from(debates);
  const rows =
    filter === "open" || filter === "running" || filter === "completed"
      ? await base.where(eq(debates.status, filter)).orderBy(desc(debates.createdAt)).limit(100)
      : await base.orderBy(desc(debates.createdAt)).limit(100);
  const ids = rows.map((d) => d.id);
  const entries = ids.length
    ? await db.select().from(debateParticipants).where(inArray(debateParticipants.debateId, ids))
    : [];
  const byDebate = new Map<string, typeof entries>();
  for (const e of entries) byDebate.set(e.debateId, [...(byDebate.get(e.debateId) ?? []), e]);
  const withEntries = rows.map((d) => ({ ...d, entries: byDebate.get(d.id) ?? [] }));
  if (filter !== "mine") return withEntries;
  return withEntries.filter((d) => d.creatorId === userId || d.entries.some((e) => e.userId === userId));
}
