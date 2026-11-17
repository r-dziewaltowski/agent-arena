/**
 * Reading pace. Models write a turn in about a second, far faster than anyone reads or speaks. So
 * each turn is released to viewers over time: at the speed of its speech when it has a voice
 * (the text follows the audio, sentence by sentence; see `voice/marks.ts`), otherwise at reading
 * pace. Every debate runs this way, watched or not, so someone who joins late still finds it going,
 * and everyone sees the same words at once.
 *
 * A turn is written (and its speech made) before viewers get any of it, while the previous turn is
 * still being shown, so the next speaker starts right after a short pause. Its full text is stored;
 * the turns API cuts it to what should be visible now. Pure functions: the browser uses them too.
 */
import { charsAt, marksDurationMs, type Mark } from "../voice/marks";

/** A short pause after a turn has been shown, before the next speaker starts. */
export const PAUSE_BETWEEN_TURNS_MS = 1_500;
/**
 * The next turn is prepared this long before the current one ends: time for the model to write it
 * and for its speech to be made (18-21 s measured, plus up to 20 s when a per-minute limit is
 * waited out), so nobody waits between speakers. A late one only makes the pause longer.
 */
export const PREPARE_AHEAD_MS = 45_000;
/** Speech plays a little faster than Gemini speaks it (pitch unchanged); the text keeps step. */
export const SPEECH_PLAYBACK_RATE = 1.2;
/** About 270 words a minute: comfortable for reading along. */
const DEFAULT_WORDS_PER_SECOND = 4.5;

/**
 * Reading pace in words per second. `DEBATE_READING_WORDS_PER_SECOND` overrides it: faster in the
 * end-to-end tests, "0" for no pacing at all (unit tests, the terminal CLI).
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

/** The end of the last whole word within the first `chars` characters (all of it at the end). */
export function wholeWords(content: string, chars: number): number {
  if (chars >= content.length) return content.length;
  if (chars <= 0) return 0;
  // Mid-word: that word isn't out yet.
  let end = chars;
  if (/\S/.test(content[end])) while (end > 0 && /\S/.test(content[end - 1])) end--;
  while (end > 0 && /\s/.test(content[end - 1])) end--;
  return end;
}

/** What decides how a turn is revealed. */
export type RevealTiming = {
  /** When viewers start getting the turn; null shows it all at once. */
  revealStartedAt: number | null;
  /** Keeps the text in step with the turn's speech; null for text-only turns. */
  marks?: Mark[] | null;
};

/** How many characters of `content` are visible `now`. */
export function revealedLength(content: string, timing: RevealTiming, now: number, wordsPerSecond: number | null): number {
  const { revealStartedAt, marks } = timing;
  if (revealStartedAt === null || (wordsPerSecond === null && !marks)) return content.length;
  const elapsed = now - revealStartedAt;
  if (elapsed <= 0) return 0;
  // Rounded up: 2500 / 1.2 * 1.2 is a hair under 2500, which would hold back the last word.
  if (marks) return wholeWords(content, charsAt(marks, Math.ceil(elapsed * SPEECH_PLAYBACK_RATE)));

  const allowed = Math.floor((elapsed / 1000) * (wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND));
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

/** How long revealing a turn takes: its speech at playback speed, or its words at reading pace. */
export function revealDurationMs(content: string, wordsPerSecond: number, marks: Mark[] | null): number {
  if (marks) return Math.ceil(marksDurationMs(marks) / SPEECH_PLAYBACK_RATE);
  return Math.ceil((countWords(content) / wordsPerSecond) * 1000);
}

/** When the next turn should be prepared, given when this one ends; null for "now". */
export function nextPrepareAt(revealEndsAt: number | null, now: number): number | null {
  if (revealEndsAt === null) return null;
  const at = revealEndsAt + PAUSE_BETWEEN_TURNS_MS - PREPARE_AHEAD_MS;
  return at > now ? at : null;
}

/** When a turn will have been fully shown; worked out for turns saved before this was stored. */
export function turnRevealEndsAt(
  turn: { content: string; revealStartedAt: number | null; revealEndsAt: number | null },
  wordsPerSecond: number | null,
): number | null {
  if (turn.revealEndsAt !== null) return turn.revealEndsAt;
  if (turn.revealStartedAt === null || wordsPerSecond === null) return null;
  return turn.revealStartedAt + revealDurationMs(turn.content, wordsPerSecond, null);
}
