/**
 * The safety net, run on a schedule. Normally every debate has exactly one message in the queue;
 * the sweep restarts debates that lost theirs (a crash between saving a turn and queuing the next,
 * a failed queue call, a local dev server restart) and starts scheduled debates whose message
 * never arrived.
 */
import { and, eq, lte, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { debates, turns } from "../db/schema";
import { LOCK_TTL_MS } from "../debate/engine";
import { startDueScheduled } from "../debate/lifecycle";
import { defaultAvailability, type JobDeps } from "./advance";

/** A running debate with no activity for this long past its due time is considered stalled. */
export const STALL_MS = 2 * 60_000;

export type SweepResult = { started: string[]; cancelled: string[]; restarted: string[] };

export async function sweep(db: Db, deps: Pick<JobDeps, "queue" | "now" | "getAvailability">): Promise<SweepResult> {
  const now = deps.now ?? Date.now;

  const [dueScheduled] = await db
    .select({ id: debates.id })
    .from(debates)
    .where(and(eq(debates.status, "open"), eq(debates.startMode, "scheduled"), lte(debates.startAt, now())))
    .limit(1);
  // Only ask Ollama what's installed when a scheduled debate is actually due.
  const due = dueScheduled
    ? await startDueScheduled(db, now(), await (deps.getAvailability ?? defaultAvailability)())
    : { started: [], cancelled: [] };
  for (const id of due.started) await deps.queue.enqueueAdvance(id, { now: now() });

  const running = await db
    .select({
      id: debates.id,
      startedAt: debates.startedAt,
      nextAttemptAt: debates.nextAttemptAt,
      lockToken: debates.lockToken,
      lockedAt: debates.lockedAt,
      lastTurnAt: max(turns.updatedAt),
    })
    .from(debates)
    .leftJoin(turns, eq(turns.debateId, debates.id))
    .where(eq(debates.status, "running"))
    .groupBy(debates.id);

  const restarted: string[] = [];
  for (const d of running) {
    if (d.lockToken !== null && (d.lockedAt ?? 0) > now() - LOCK_TTL_MS) continue; // a turn is in progress
    const expectedBy = Math.max(d.startedAt ?? 0, d.lastTurnAt ?? 0, d.nextAttemptAt ?? 0);
    if (now() - expectedBy < STALL_MS) continue;
    await deps.queue.enqueueAdvance(d.id, { now: now() });
    restarted.push(d.id);
  }
  return { ...due, restarted };
}
