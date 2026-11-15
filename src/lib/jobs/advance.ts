/**
 * What one queue message does for one debate: start it if it's a scheduled debate that is due,
 * generate one turn if it's running, and queue the next message. Called by `/api/jobs/advance`.
 */
import { eq } from "drizzle-orm";
import { catalogAvailability, listOllamaModels, type ModelAvailability } from "../ai/models";
import type { Db } from "../db/client";
import { debates } from "../db/schema";
import { runStep, type StepOptions, type StepOutcome } from "../debate/engine";
import { startOrCancelScheduled } from "../debate/lifecycle";
import type { JobQueue } from "./queue";

export type JobDeps = StepOptions & {
  queue: JobQueue;
  /** Which models can still be used, checked when a scheduled debate starts. */
  getAvailability?: () => Promise<ModelAvailability>;
};

export type AdvanceResult =
  | { kind: "gone" }
  | { kind: "idle"; status: string }
  | { kind: "not_due"; requeuedFor: number }
  | { kind: "cancelled" }
  | { kind: "step"; outcome: StepOutcome; requeuedFor: number | "now" | null };

export const defaultAvailability = async () => catalogAvailability(await listOllamaModels());

async function loadDebate(db: Db, debateId: string) {
  const [debate] = await db.select().from(debates).where(eq(debates.id, debateId));
  return debate;
}

export async function advanceDebate(db: Db, debateId: string, deps: JobDeps): Promise<AdvanceResult> {
  const now = deps.now ?? Date.now;
  let debate = await loadDebate(db, debateId);
  if (!debate) return { kind: "gone" };

  if (debate.status === "open") {
    if (debate.startMode !== "scheduled" || debate.startAt === null) return { kind: "idle", status: debate.status };
    if (debate.startAt > now()) {
      // Early: the start time is beyond the queue's maximum delay, or the clocks differ slightly.
      await deps.queue.enqueueAdvance(debateId, { at: debate.startAt, now: now() });
      return { kind: "not_due", requeuedFor: debate.startAt };
    }
    const availability = await (deps.getAvailability ?? defaultAvailability)();
    const result = await startOrCancelScheduled(db, debateId, now(), availability);
    if (result === "cancelled") return { kind: "cancelled" };
    debate = await loadDebate(db, debateId);
    if (!debate) return { kind: "gone" };
  }

  if (debate.status !== "running") return { kind: "idle", status: debate.status };

  const outcome = await runStep(db, debateId, deps);
  const requeuedFor = await chain(db, debateId, outcome, deps);
  return { kind: "step", outcome, requeuedFor };
}

/** Queues the message after a step, per its outcome. Returns when it was queued for, or null. */
async function chain(db: Db, debateId: string, outcome: StepOutcome, deps: JobDeps): Promise<number | "now" | null> {
  const now = deps.now ?? Date.now;
  switch (outcome.kind) {
    case "turn":
      if (outcome.debateCompleted) return null;
      await deps.queue.enqueueAdvance(debateId, { now: now() });
      return "now";
    case "waiting":
      await deps.queue.enqueueAdvance(debateId, { at: outcome.nextAttemptAt, now: now() });
      return outcome.nextAttemptAt;
    case "failed":
      return null;
    case "retrying":
    case "skipped": {
      // `retrying` set a short delay. `skipped` means another call holds the lock (it queues the
      // next step itself), the debate isn't running any more, or this message came before
      // `nextAttemptAt`, which is the one case that needs queuing again.
      const debate = await loadDebate(db, debateId);
      if (!debate || debate.status !== "running") return null;
      if (outcome.kind === "skipped" && (debate.lockToken !== null || debate.nextAttemptAt === null)) return null;
      const at = debate.nextAttemptAt ?? now();
      await deps.queue.enqueueAdvance(debateId, { at, now: now() });
      return at > now() ? at : "now";
    }
  }
}

/**
 * Queues the first message after a debate changes: a debate that is now running gets a step right
 * away, a scheduled one gets a message at its start time. Called by the server actions after
 * creating, entering (a `when_full` debate starts on its last entry), starting or resuming.
 * `runningOnly` skips the scheduled-start message: entering a scheduled debate must not queue
 * another one, since creating it already did.
 */
export async function queueDebate(
  db: Db,
  debateId: string,
  queue: JobQueue,
  opts: { now?: number; runningOnly?: boolean } = {},
): Promise<void> {
  const now = opts.now ?? Date.now();
  const debate = await loadDebate(db, debateId);
  if (!debate) return;
  if (debate.status === "running") {
    await queue.enqueueAdvance(debateId, { now });
  } else if (
    !opts.runningOnly &&
    debate.status === "open" &&
    debate.startMode === "scheduled" &&
    debate.startAt !== null
  ) {
    await queue.enqueueAdvance(debateId, { at: debate.startAt, now });
  }
}
