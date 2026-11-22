/**
 * Telling a debate's viewers that something changed (events.ts). Two ways out:
 *
 * - **Ably** when `ABLY_API_KEY` is set (production): one HTTP call per event; Ably holds the
 *   viewers' connections.
 * - **In this process** always: listeners registered here (the local stream route,
 *   `/api/debates/[id]/events`, in development and the end-to-end tests; unit tests). On Vercel
 *   nothing listens here, since each request may run in a different function.
 *
 * Publishing never throws and never takes long: viewers who miss an event catch up on their next
 * fetch, and polling takes over whenever the stream is down.
 */
import { ablyKey, ablyStreamUrl, publishToAbly } from "./ably";
import type { DebateEvent } from "./events";

type Listener = (event: DebateEvent) => void;
const BUS_KEY = Symbol.for("agent-arena.realtime-bus");

/** Kept on globalThis: route handlers and server actions may load separate copies of this module. */
function bus(): Map<string, Set<Listener>> {
  const g = globalThis as { [BUS_KEY]?: Map<string, Set<Listener>> };
  return (g[BUS_KEY] ??= new Map());
}

/** Hears one debate's events in this process. Returns the function that stops listening. */
export function listen(debateId: string, listener: Listener): () => void {
  const listeners = bus().get(debateId) ?? new Set();
  listeners.add(listener);
  bus().set(debateId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) bus().delete(debateId);
  };
}

export async function publish(debateId: string, event: DebateEvent): Promise<void> {
  for (const listener of bus().get(debateId) ?? []) {
    try {
      listener(event);
    } catch (err) {
      console.error("[realtime] listener failed", err);
    }
  }
  const key = ablyKey();
  if (!key) return;
  try {
    await publishToAbly(key, debateId, event.type, JSON.stringify(event));
  } catch (err) {
    console.error(`[realtime] debate ${debateId}: ${event.type} not pushed`, err instanceof Error ? err.message : err);
  }
}

/** Publishes the same event to several debates (e.g. an agent withdrawn from every open one). */
export async function publishEach(debateIds: Iterable<string>, event: DebateEvent): Promise<void> {
  await Promise.all([...new Set(debateIds)].map((id) => publish(id, event)));
}

/**
 * Where a browser should listen for a debate's events: Ably's address with a fresh token, the
 * local stream when this server can hold connections itself (not on Vercel), or null: poll.
 */
export async function streamUrlFor(debateId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (env.REALTIME === "off") return null;
  const key = ablyKey(env);
  if (key) return ablyStreamUrl(key, debateId);
  return localStreamAllowed(env) ? `/api/debates/${debateId}/events` : null;
}

/** The local stream needs one long-running process: development, `next start`, the tests. */
export function localStreamAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL && env.REALTIME !== "off";
}
