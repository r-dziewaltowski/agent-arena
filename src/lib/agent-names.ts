import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { agents } from "./db/schema";

/**
 * Whether the user already has another agent with this name, ignoring case and surrounding
 * spaces (the same rule as the database's unique index). `exceptId` is the agent being edited.
 */
export async function isAgentNameTaken(db: Db, ownerId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.ownerId, ownerId),
        sql`lower(${agents.name}) = lower(${name.trim()})`,
        exceptId ? ne(agents.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export const nameTakenMessage = (name: string) => `You already have an agent called “${name.trim()}”. Pick another name.`;
