/**
 * Reading pace. Models write a turn in about a second, far faster than anyone reads. So each
 * turn's text is released to viewers at reading pace from the moment its first words arrive, and
 * the next turn starts only once it has all been shown. Every debate runs at this pace, watched or
 * not, so someone who joins late still finds it going, and everyone sees the same words at once.
 *
 * The full text is stored as it's written; the turns API cuts it to what should be visible now.
 */

/** A short pause after a turn has been shown, before the next speaker starts. */
export const PAUSE_BETWEEN_TURNS_MS = 1_500;
/** About 270 words a minute: comfortable for reading along. */
const DEFAULT_WORDS_PER_SECOND = 4.5;

/**
 * Reading pace in words per second. `DEBATE_READING_WORDS_PER_SECOND` overrides it: faster in the
 * end-to-end tests, "0" for no pacing at all (unit tests).
 */
export function readingWordsPerSecond(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.DEBATE_READING_WORDS_PER_SECOND;
  if (raw === "0") return null;
  const value = Number(raw);
  return raw && Number.isFinite(value) && value > 0 ? value : DEFAULT_WORDS_PER_SECOND;
}

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** How many characters of `content` are visible `now`, for a turn revealed from `revealStartedAt`. */
export function revealedLength(content: string, revealStartedAt: number | null, now: number, wordsPerSecond: number | null): number {
  if (revealStartedAt === null || wordsPerSecond === null) return content.length;
  const allowed = Math.floor((Math.max(0, now - revealStartedAt) / 1000) * wordsPerSecond);
  if (allowed <= 0) return 0;
  const words = /\S+/g;
  let end = 0;
  for (let n = 0; n < allowed; n++) {
    const match = words.exec(content);
    if (!match) return content.length;
    end = match.index + match[0].length;
  }
  // Every word is out: include any trailing whitespace too, so the turn reads as complete.
  return words.exec(content) ? end : content.length;
}

/** When the whole of `content` will have been shown. */
export function revealEndsAt(content: string, revealStartedAt: number, wordsPerSecond: number): number {
  return revealStartedAt + Math.ceil((countWords(content) / wordsPerSecond) * 1000);
}

/** When the next turn may start after a turn revealed from `revealStartedAt`, or null for "now". */
export function nextTurnAt(content: string, revealStartedAt: number | null, now: number, wordsPerSecond: number | null): number | null {
  if (revealStartedAt === null || wordsPerSecond === null) return null;
  const at = revealEndsAt(content, revealStartedAt, wordsPerSecond) + PAUSE_BETWEEN_TURNS_MS;
  return at > now ? at : null;
}
