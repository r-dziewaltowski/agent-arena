/**
 * The queue seam. Debates are driven by messages: each one makes the queue call the app's
 * `/api/jobs/advance` route for one debate, which does one step and queues the next message.
 * Production uses Upstash QStash; tests use `fakeQueue`. Another queue can replace QStash by
 * implementing `JobQueue`.
 */
import { Client } from "@upstash/qstash";
import { appUrl, qstashConfig, sweepCron, turnParallelism } from "./config";

export const ADVANCE_PATH = "/api/jobs/advance";
export const SWEEP_PATH = "/api/jobs/sweep";
/** One schedule id, so creating the sweep schedule again updates it instead of adding another. */
export const SWEEP_SCHEDULE_ID = "agent-arena-sweep";
/** All turn messages share one flow-control key, which caps how many turns run at once. */
const FLOW_CONTROL_KEY = "agent-arena-turns";
/**
 * QStash's free plan delays a message by at most 7 days. Later times are clamped to this (with a
 * margin); the advance route then sees the debate isn't due yet and queues itself again.
 */
export const MAX_DELAY_MS = 7 * 24 * 60 * 60_000 - 60 * 60_000;

export type AdvanceMessage = { debateId: string };

export interface JobQueue {
  /** Asks the queue to call the advance route for this debate, at `at` (epoch ms) or right away. */
  enqueueAdvance(debateId: string, opts?: { at?: number; now?: number }): Promise<void>;
}

/** When a message should be delivered, as whole epoch seconds, or undefined for "now". */
export function deliveryTime(at: number | undefined, now: number): number | undefined {
  if (at === undefined || at <= now) return undefined;
  // Rounded up, so a message never arrives before the time the debate is waiting for.
  return Math.ceil(Math.min(at, now + MAX_DELAY_MS) / 1000);
}

/** Headers that let QStash reach a Vercel preview deployment despite its login protection. */
function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

export function qstashQueue(client = new Client(qstashConfig())): JobQueue {
  return {
    async enqueueAdvance(debateId, opts = {}) {
      const body: AdvanceMessage = { debateId };
      await client.publishJSON({
        url: appUrl() + ADVANCE_PATH,
        body,
        notBefore: deliveryTime(opts.at, opts.now ?? Date.now()),
        flowControl: { key: FLOW_CONTROL_KEY, parallelism: turnParallelism() },
        headers: bypassHeaders(),
      });
    },
  };
}

/** Creates or updates the schedule that calls the sweep route (see `sweep.ts`). */
export async function ensureSweepSchedule(
  opts: { baseUrl?: string; cron?: string } = {},
  client = new Client(qstashConfig()),
): Promise<void> {
  await client.schedules.create({
    scheduleId: SWEEP_SCHEDULE_ID,
    destination: (opts.baseUrl ?? appUrl()) + SWEEP_PATH,
    cron: opts.cron ?? sweepCron(),
    headers: bypassHeaders(),
  });
}

let cached: JobQueue | undefined;

/** The app's queue (QStash). */
export function getQueue(): JobQueue {
  cached ??= qstashQueue();
  return cached;
}

/** A queue that only records messages, for tests. */
export function fakeQueue() {
  const messages: { debateId: string; at?: number }[] = [];
  const queue: JobQueue = {
    async enqueueAdvance(debateId, opts = {}) {
      messages.push(opts.at === undefined ? { debateId } : { debateId, at: opts.at });
    },
  };
  return { queue, messages };
}
