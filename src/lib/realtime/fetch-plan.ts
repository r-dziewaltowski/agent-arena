/**
 * When a debate page fetches the turns endpoint, and whether the CDN may share the answer.
 * Shared by the endpoint and the browser, so no server-only imports here.
 *
 * No answer depends on who's asking. They differ only in the comments catch-up:
 * - **Catch-up** (with `commentsSince`, this browser's comments cursor): also the chat comments
 *   posted, deleted or removed since then, for the gaps pushed comments can't cover. Never cached,
 *   since every browser's cursor differs. Used by fallback polling (no stream: the only way
 *   comments arrive) and once each time the stream (re)connects (comments sent while it was down,
 *   or before it opened, are never delivered later).
 * - **Shared** (with a version `v`): the same for everyone watching, so the CDN keeps it for a
 *   couple of seconds. Used after a `turns` event (`v=e<event time>`), when a turn is due to start
 *   or end (`v=m<that moment>`), and for a safety fetch every 30 s (`v=s<30-second slot>`). The
 *   version makes each burst its own cache entry, so nobody gets an answer from before the change
 *   they were told about.
 */
import { revealDurationMs } from "../debate/pacing";
import type { Mark } from "../voice/marks";

/** Without pushed events: how often the turns are fetched. */
export const POLL_MS = 1_000;
/** With pushed events: a fetch at least this often anyway, in case an event was missed. */
export const SAFETY_FETCH_MS = 30_000;
/** Viewers woken by the same event fetch at random within this window, not all in one instant. */
export const SPREAD_MS = 800;
/** How long the CDN keeps a shared answer. */
export const SHARED_CACHE_SECONDS = 2;

const VERSION = /^[ems]\d{1,15}(-\d{1,3})?$/;

/** The endpoint's caching: shared answers for a couple of seconds, everything else never. */
export function turnsCacheControl(query: { commentsSince: number; version: string | null }): string {
  if (query.commentsSince > 0 || !query.version || !VERSION.test(query.version)) return "no-store";
  return `public, max-age=0, s-maxage=${SHARED_CACHE_SECONDS}`;
}

/** What the next fetch asks for: the comments catch-up, or a shared answer under a version. */
export type Ask = { catchUp: true } | { catchUp: false; version: string };

export const CATCH_UP: Ask = { catchUp: true };

/** A shared fetch after a `turns` event published at `at` (an event without a time catches up). */
export function eventAsk(at: number | undefined): Ask {
  return at ? { catchUp: false, version: `e${at}` } : CATCH_UP;
}

type TurnTiming = { status: string; reveal: { startsAt: number; full: string; marks: Mark[] | null } | null };

/** The last moment asked about, so asking again for the same one gets a fresh cache entry. */
export type LastMoment = { moment: number; attempt: number } | null;

/**
 * With pushed events, when to fetch next and how: just after the next known moment (the upcoming
 * turn starts, or the one being shown ends), else the safety fetch. `now` is the server's time as
 * this browser reckons it. A moment that has passed but whose answer didn't show it yet (the
 * request arrived a little early) is asked about again, under a new version. A turn written live
 * without pacing (the terminal CLI's setting) keeps polling.
 */
export function nextFetch(
  data: { turns: TurnTiming[]; upcoming: { startsAt: number } | null },
  wordsPerSecond: number | null,
  now: number,
  lastMoment: LastMoment,
  random: () => number = Math.random,
): { delayMs: number; ask: Ask; moment: LastMoment } {
  if (data.turns.some((t) => t.status === "streaming" && !t.reveal)) return { delayMs: POLL_MS, ask: CATCH_UP, moment: lastMoment };

  const moments = data.turns.flatMap((t) =>
    t.reveal ? [t.reveal.startsAt + revealDurationMs(t.reveal.full, wordsPerSecond ?? 4.5, t.reveal.marks)] : [],
  );
  if (data.upcoming) moments.push(data.upcoming.startsAt);
  const soonest = Math.min(...moments);
  if (!Number.isFinite(soonest) || soonest - now >= SAFETY_FETCH_MS) {
    // Everyone whose safety fetch falls in the same 30-second slot shares one answer.
    const slot = Math.floor((now + SAFETY_FETCH_MS) / SAFETY_FETCH_MS);
    return { delayMs: SAFETY_FETCH_MS, ask: { catchUp: false, version: `s${slot}` }, moment: lastMoment };
  }

  const delayMs = Math.max(250, soonest - now + 100 + random() * 500);
  const attempt = lastMoment?.moment === soonest ? lastMoment.attempt + 1 : 0;
  const version = attempt ? `m${soonest}-${attempt}` : `m${soonest}`;
  return { delayMs, ask: { catchUp: false, version }, moment: { moment: soonest, attempt } };
}
