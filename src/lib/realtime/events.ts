/**
 * What the server tells a debate's viewers, pushed down one event stream per debate (see
 * `publish.ts` on the server and `use-debate-events.ts` in the browser). Shared by both, so no
 * server-only imports here.
 *
 * Turn text is never pushed: the turns endpoint still releases a turn only once it starts, so
 * nobody can read ahead and everyone sees the same words at once. A `turns` event only says
 * "something in the transcript changed; fetch it". Comments are public the moment they're posted,
 * so they travel whole.
 */
import type { CommentView } from "../chat-shared";

export type DebateEvent =
  /** The page around the transcript changed (an entry, the start, a cancellation): reload it. */
  | { type: "refresh" }
  /**
   * A turn was saved, or the debate's state changed (waiting, failed, finished): fetch the turns.
   * `at`: when it was published, so everyone fetching for it shares one cached answer.
   */
  | { type: "turns"; at?: number }
  /** A comment was posted, deleted by its author (`gone`) or removed by an admin (`removed`). */
  | { type: "comment"; comment: CommentView };

/** The channel a debate's events go to (Ably channel names use ":" between segments). */
export function channelFor(debateId: string): string {
  return `debate:${debateId}`;
}

/** Reads one event off the stream; null for anything that isn't one (a keepalive, a newer type). */
export function parseEvent(text: string): DebateEvent | null {
  try {
    const value = JSON.parse(text) as { type?: unknown; comment?: unknown; at?: unknown };
    if (value.type === "refresh") return { type: "refresh" };
    if (value.type === "turns") return typeof value.at === "number" ? { type: "turns", at: value.at } : { type: "turns" };
    if (value.type === "comment" && value.comment && typeof value.comment === "object") return value as DebateEvent;
    return null;
  } catch {
    return null;
  }
}
