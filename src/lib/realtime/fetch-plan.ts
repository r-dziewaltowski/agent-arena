/**
 * When a debate page fetches the turns endpoint, and whether the CDN may share the answer.
 * Shared by the endpoint and the browser, so no server-only imports here.
 *
 * The endpoint answers in two ways:
 * - **Personal** (with `commentsSince`): the chat comments this viewer may have missed, marked
 *   with which are theirs. Never cached. Used by fallback polling, by the catch-up when the
 *   stream (re)connects, and by a safety fetch every 30 s.
 * - **Shared** (with a version `v` and no `commentsSince`): the same for everyone watching, so the
 *   CDN keeps it for a couple of seconds. Used for the bursts where every viewer fetches at once:
 *   after a `turns` event (`v=e<event time>`) and when a turn is due to start or end
 *   (`v=m<that moment>`). The version makes each burst its own cache entry, so nobody gets an
 *   answer from before the change they were told about.
 */
import { revealDurationMs } from "../debate/pacing";
import type { Mark } from "../voice/marks";

/** Without pushed events: how often the turns are fetched. */
export const POLL_MS = 1_000;
/** With pushed events: a personal fetch at least this often, in case a comment was missed. */
export const SAFETY_FETCH_MS = 30_000;
/** Viewers woken by the same event fetch at random within this window, not all in one instant. */
export const SPREAD_MS = 800;
/** How long the CDN keeps a shared answer. */
export const SHARED_CACHE_SECONDS = 2;

const VERSION = /^[em]\d{1,15}(-\d{1,3})?$/;

/** The endpoint's caching: shared answers for a couple of seconds, everything else never. */
export function turnsCacheControl(query: { commentsSince: number; version: string | null }): string {
  if (query.commentsSince > 0 || !query.version || !VERSION.test(query.version)) return "no-store";
  return `public, max-age=0, s-maxage=${SHARED_CACHE_SECONDS}`;
}

/** What the next fetch asks for. */
export type Ask = { personal: true } | { personal: false; version: string };

/** A shared fetch after a `turns` event published at `at`. */
export function eventAsk(at: number | undefined): Ask {
  return at ? { personal: false, version: `e${at}` } : { personal: true };
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
  lastPersonalAt: number,
  lastMoment: LastMoment,
  random: () => number = Math.random,
): { delayMs: number; ask: Ask; moment: LastMoment } {
  const personal = { personal: true } as const;
  if (data.turns.some((t) => t.status === "streaming" && !t.reveal)) return { delayMs: POLL_MS, ask: personal, moment: lastMoment };

  const moments = data.turns.flatMap((t) =>
    t.reveal ? [t.reveal.startsAt + revealDurationMs(t.reveal.full, wordsPerSecond ?? 4.5, t.reveal.marks)] : [],
  );
  if (data.upcoming) moments.push(data.upcoming.startsAt);
  const soonest = Math.min(...moments);
  if (!Number.isFinite(soonest) || soonest - now >= SAFETY_FETCH_MS) {
    return { delayMs: SAFETY_FETCH_MS, ask: personal, moment: lastMoment };
  }

  const delayMs = Math.max(250, soonest - now + 100 + random() * 500);
  // This viewer's comments catch-up is due: make this fetch the personal one.
  if (now + delayMs - lastPersonalAt >= SAFETY_FETCH_MS) return { delayMs, ask: personal, moment: lastMoment };
  const attempt = lastMoment?.moment === soonest ? lastMoment.attempt + 1 : 0;
  const version = attempt ? `m${soonest}-${attempt}` : `m${soonest}`;
  return { delayMs, ask: { personal: false, version }, moment: { moment: soonest, attempt } };
}
