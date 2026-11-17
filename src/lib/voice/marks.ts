/**
 * Keeping a turn's text in step with its audio. Gemini doesn't say when each word is spoken, so we
 * find the pauses between sentences in the audio and pin each sentence to the stretch of speech
 * between them; within a sentence, characters are spread evenly. The result is a list of marks
 * (media time in ms, characters shown) that the server and every browser read the same way.
 */

/** A point on the turn's timeline: by `ms` into the audio, `chars` characters have been spoken. */
export type Mark = [ms: number, chars: number];

/** Character offsets just after each sentence; the last is always `text.length`. */
export function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)|\n\s*\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const end = match.index + match[0].length;
    const from = ends.at(-1) ?? 0;
    if (text.slice(from, end).trim()) ends.push(end);
  }
  const from = ends.at(-1) ?? 0;
  if (ends.length === 0 || text.slice(from).trim()) ends.push(text.length);
  else ends[ends.length - 1] = text.length;
  return ends;
}

type Pause = { start: number; end: number };

const FRAME_MS = 10;
/** A gap shorter than this is a breath inside a sentence, not a pause between sentences. */
const MIN_PAUSE_MS = 150;

/** Where speech starts and ends, and the silent gaps in between (all in ms). */
export function findPauses(samples: Int16Array, sampleRate: number): { speechStart: number; speechEnd: number; pauses: Pause[] } {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(samples.length, i + frame);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / (end - i)));
  }
  const total = (samples.length / sampleRate) * 1000;
  if (levels.length === 0) return { speechStart: 0, speechEnd: total, pauses: [] };

  // Silence is anything well below the level of ordinary speech.
  const sorted = [...levels].sort((a, b) => a - b);
  const speechLevel = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = Math.max(speechLevel * 0.1, 50);
  const voiced = levels.map((l) => l >= threshold);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { speechStart: 0, speechEnd: total, pauses: [] };

  const pauses: Pause[] = [];
  let runStart = -1;
  for (let f = first; f <= last; f++) {
    if (!voiced[f]) {
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      if ((f - runStart) * FRAME_MS >= MIN_PAUSE_MS) pauses.push({ start: runStart * FRAME_MS, end: f * FRAME_MS });
      runStart = -1;
    }
  }
  return { speechStart: first * FRAME_MS, speechEnd: Math.min(total, (last + 1) * FRAME_MS), pauses };
}

/**
 * How much a longer pause is preferred over one closer to where a sentence break is expected:
 * each extra ms of pause (up to a second) is worth this many ms of distance.
 */
const PAUSE_LENGTH_WEIGHT = 3;

/**
 * Picks one pause per sentence break, in order. A break is expected where its share of the text
 * falls in the speech; speakers also pause at commas and colons, but usually longer between
 * sentences, so among nearby pauses the longer ones win. Dynamic programming over (break, pause).
 */
function alignBreaks(ends: number[], length: number, pauses: Pause[], speechStart: number, speechEnd: number): Pause[] | null {
  const breaks = ends.length - 1;
  if (breaks === 0) return [];
  if (pauses.length < breaks) return null;
  const expected = ends.slice(0, -1).map((e) => speechStart + (e / length) * (speechEnd - speechStart));
  const cost = (i: number, j: number) => {
    const p = pauses[j];
    return Math.abs((p.start + p.end) / 2 - expected[i]) - PAUSE_LENGTH_WEIGHT * Math.min(p.end - p.start, 1000);
  };
  // best[i][j]: lowest cost with break i on pause j; from[i][j]: the pause chosen for break i - 1.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < breaks; i++) {
    best.push(new Array(pauses.length).fill(Infinity));
    from.push(new Array(pauses.length).fill(-1));
    for (let j = i; j < pauses.length - (breaks - 1 - i); j++) {
      if (i === 0) {
        best[i][j] = cost(i, j);
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const total = best[i - 1][k] + cost(i, j);
        if (total < best[i][j]) {
          best[i][j] = total;
          from[i][j] = k;
        }
      }
    }
  }
  let j = best[breaks - 1].indexOf(Math.min(...best[breaks - 1]));
  const chosen: Pause[] = [];
  for (let i = breaks - 1; i >= 0; i--) {
    chosen.unshift(pauses[j]);
    j = from[i][j];
  }
  return chosen;
}

/**
 * Marks for `text` spoken in `samples`. Each sentence gets the speech between the pauses matched
 * to its breaks. If that doesn't add up (too few pauses, or a sentence that would be spoken
 * implausibly fast or slow), the text is spread evenly over the whole of the speech instead.
 */
export function buildMarks(text: string, samples: Int16Array, sampleRate: number): Mark[] {
  const total = Math.round((samples.length / sampleRate) * 1000);
  const { speechStart, speechEnd, pauses } = findPauses(samples, sampleRate);
  const ends = sentenceEnds(text);
  const even: Mark[] = dedupe([
    [0, 0],
    [speechStart, 0],
    [speechEnd, text.length],
    [total, text.length],
  ]);
  if (ends.length < 2) return even;
  const chosen = alignBreaks(ends, text.length, pauses, speechStart, speechEnd);
  if (!chosen) return even;
  const overallRate = text.length / Math.max(1, speechEnd - speechStart);
  const plausible = (chars: number, ms: number) => {
    const rate = chars / Math.max(1, ms);
    return rate >= overallRate * 0.4 && rate <= overallRate * 2.5;
  };
  const marks: Mark[] = [[0, 0]];
  let chars = 0;
  for (let i = 0; i < ends.length; i++) {
    const from = i === 0 ? speechStart : chosen[i - 1].end;
    const to = i === ends.length - 1 ? speechEnd : chosen[i].start;
    if (!plausible(ends[i] - chars, to - from)) return even;
    marks.push(...clauseMarks(text.slice(chars, ends[i]), chars, from, to, pauses, plausible));
    chars = ends[i];
  }
  marks.push([total, text.length]);
  return dedupe(marks);
}

/** Character offsets just after each clause (comma, colon, semicolon, dash) of a sentence. */
function clauseEnds(sentence: string): number[] {
  const ends: number[] = [];
  const re = /[,;:—–]["'”’)\]]*(?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sentence))) ends.push(match.index + match[0].length);
  const body = sentence.trimEnd().length;
  return [...ends.filter((e) => e < body), sentence.length];
}

/**
 * Marks for one sentence spoken from `from` to `to`: speakers often pause at commas and colons
 * too, so those pauses are matched to the sentence's clauses the same way sentences were. Without
 * enough pauses, the sentence is spread evenly.
 */
function clauseMarks(
  sentence: string,
  offset: number,
  from: number,
  to: number,
  pauses: Pause[],
  plausible: (chars: number, ms: number) => boolean,
): Mark[] {
  const whole: Mark[] = [
    [from, offset],
    [to, offset + sentence.length],
  ];
  const ends = clauseEnds(sentence);
  const inside = pauses.filter((p) => p.start > from && p.end < to);
  const chosen = ends.length > 1 ? alignBreaks(ends, sentence.length, inside, from, to) : null;
  if (!chosen) return whole;
  const marks: Mark[] = [];
  let chars = 0;
  for (let i = 0; i < ends.length; i++) {
    const start = i === 0 ? from : chosen[i - 1].end;
    const end = i === ends.length - 1 ? to : chosen[i].start;
    if (!plausible(ends[i] - chars, end - start)) return whole;
    marks.push([start, offset + chars], [end, offset + ends[i]]);
    chars = ends[i];
  }
  return marks;
}

function dedupe(marks: Mark[]): Mark[] {
  return marks.filter((m, i) => i === 0 || m[0] !== marks[i - 1][0] || m[1] !== marks[i - 1][1]);
}

/** How many characters have been spoken `ms` into the audio. */
export function charsAt(marks: Mark[], ms: number): number {
  if (marks.length === 0) return 0;
  if (ms <= marks[0][0]) return marks[0][1];
  for (let i = 1; i < marks.length; i++) {
    const [t1, c1] = marks[i];
    if (ms < t1) {
      const [t0, c0] = marks[i - 1];
      return Math.floor(c0 + ((c1 - c0) * (ms - t0)) / Math.max(1, t1 - t0));
    }
  }
  return marks[marks.length - 1][1];
}

/** The audio's length according to its marks (the last mark is the end of the file). */
export function marksDurationMs(marks: Mark[]): number {
  return marks.at(-1)?.[0] ?? 0;
}

/** Parses marks stored as JSON; null for anything that isn't a list of [ms, chars] pairs. */
export function parseMarks(raw: string | null | undefined): Mark[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length === 0) return null;
    if (!value.every((m) => Array.isArray(m) && m.length === 2 && m.every((n) => typeof n === "number"))) return null;
    return value as Mark[];
  } catch {
    return null;
  }
}
