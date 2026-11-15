import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { debates } from "../db/schema";
import { runStep, type StepOptions, type StepOutcome } from "./engine";
import { startDueScheduled } from "./lifecycle";

export type RunOnceResult = {
  started: string[];
  cancelled: string[];
  steps: { debateId: string; outcome: StepOutcome }[];
};

/**
 * One pass of the worker: start or cancel scheduled debates that are due, then generate one turn
 * for each running debate that is ready. One generation at a time, since local Ollama handles one
 * request well; debates take turns, so none of them starves.
 */
export async function runOnce(db: Db, opts: StepOptions = {}): Promise<RunOnceResult> {
  const now = opts.now ?? Date.now;
  const { started, cancelled } = await startDueScheduled(db, now());

  const ready = await db
    .select({ id: debates.id })
    .from(debates)
    .where(
      and(
        eq(debates.status, "running"),
        or(isNull(debates.nextAttemptAt), lte(debates.nextAttemptAt, now())),
      ),
    )
    .orderBy(asc(debates.startedAt));

  const steps: RunOnceResult["steps"] = [];
  for (const { id } of ready) {
    steps.push({ debateId: id, outcome: await runStep(db, id, opts) });
  }
  return { started, cancelled, steps };
}

/** Runs the worker loop until `signal` is aborted. Sleeps only when there was nothing to do. */
export async function runLoop(
  db: Db,
  opts: StepOptions & {
    intervalMs?: number;
    signal?: AbortSignal;
    onPass?: (result: RunOnceResult) => void;
  } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2_000;
  while (!opts.signal?.aborted) {
    const result = await runOnce(db, opts);
    opts.onPass?.(result);
    const didWork = result.steps.some((s) => s.outcome.kind !== "skipped");
    if (!didWork) await sleep(intervalMs, opts.signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
