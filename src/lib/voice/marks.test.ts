import { describe, expect, it } from "vitest";
import { fakeSpeechSamples } from "./fake-speech";
import { buildMarks, charsAt, findPauses, marksDurationMs, parseMarks, sentenceEnds, type Mark } from "./marks";

const RATE = 24_000;

/** Speech-like audio: a tone for each `[ms of sound, ms of silence]` pair. */
function audio(parts: [sound: number, silence: number][]): Int16Array {
  const out: number[] = [];
  for (const [sound, silence] of parts) {
    for (let i = 0; i < (RATE * sound) / 1000; i++) out.push(Math.round(5000 * Math.sin((2 * Math.PI * 200 * i) / RATE)));
    for (let i = 0; i < (RATE * silence) / 1000; i++) out.push(0);
  }
  return Int16Array.from(out);
}

describe("sentenceEnds", () => {
  it("finds the end of each sentence, keeping closing quotes, and not decimals", () => {
    const text = 'Cars cost 3.5 times more. "Really?" Yes! And then';
    const ends = sentenceEnds(text);
    expect(ends.map((e, i) => text.slice(i ? ends[i - 1] : 0, e).trim())).toEqual([
      "Cars cost 3.5 times more.",
      '"Really?"',
      "Yes!",
      "And then",
    ]);
  });

  it("treats a whole text without punctuation as one sentence", () => {
    expect(sentenceEnds("no full stop here")).toEqual([17]);
  });
});

describe("findPauses", () => {
  it("finds the speech and the silent gaps longer than a breath", () => {
    const { speechStart, speechEnd, pauses } = findPauses(audio([[0, 200], [1000, 100], [1000, 500], [1000, 0]]), RATE);
    expect(speechStart).toBeGreaterThanOrEqual(190);
    expect(speechStart).toBeLessThanOrEqual(210);
    expect(speechEnd).toBeGreaterThan(3700);
    // The 100 ms gap is a breath; the 500 ms one is a pause.
    expect(pauses).toHaveLength(1);
    expect(pauses[0].end - pauses[0].start).toBeGreaterThanOrEqual(480);
  });
});

describe("buildMarks", () => {
  it("pins each sentence to the speech between the pauses", () => {
    const text = "First sentence here. Second one is a bit longer. Third.";
    const ends = sentenceEnds(text);
    // Three bursts of speech roughly in proportion to the sentences, with pauses between.
    const marks = buildMarks(text, audio([[0, 100], [1300, 600], [1800, 600], [400, 100]]), RATE);
    const sentenceDone = (end: number) => marks.find((m) => m[1] === end)![0];
    expect(sentenceDone(ends[0])).toBeGreaterThan(1300);
    expect(sentenceDone(ends[0])).toBeLessThan(1450);
    expect(sentenceDone(ends[1])).toBeGreaterThan(3700);
    expect(sentenceDone(ends[1])).toBeLessThan(3850);
    expect(marks.at(-1)).toEqual([marksDurationMs(marks), text.length]);
  });

  it("prefers the sentence break over a longer pause at a comma far from where it should be", () => {
    const text = "Short one. Then a long sentence, with a dramatic pause, that goes on for a good while longer.";
    // Pause after "Short one." (350 ms), then a long dramatic pause (900 ms) in the middle of the second.
    const marks = buildMarks(text, audio([[0, 100], [700, 350], [1600, 900], [3000, 100]]), RATE);
    const firstDone = marks.find((m) => m[1] === sentenceEnds(text)[0])![0];
    expect(firstDone).toBeLessThan(900);
  });

  it("spreads the text evenly when the pauses don't fit the sentences", () => {
    const text = "One. Two. Three. Four.";
    const marks = buildMarks(text, audio([[0, 100], [3000, 100]]), RATE); // no pauses at all
    expect(marks).toHaveLength(4);
    expect(marks[2][1]).toBe(text.length);
  });

  it("works on the end-to-end tests' stand-in voice", () => {
    const text = "We should act now. The evidence is clear, and waiting costs more.";
    const samples = fakeSpeechSamples(text);
    const marks = buildMarks(text, samples, RATE);
    expect(marks.some((m) => m[1] === sentenceEnds(text)[0])).toBe(true);
  });
});

describe("charsAt", () => {
  const marks: Mark[] = [
    [0, 0],
    [100, 0],
    [1100, 50],
    [1500, 50],
    [2500, 100],
  ];
  it("interpolates within speech and holds still in pauses", () => {
    expect(charsAt(marks, 50)).toBe(0);
    expect(charsAt(marks, 600)).toBe(25);
    expect(charsAt(marks, 1300)).toBe(50);
    expect(charsAt(marks, 2000)).toBe(75);
    expect(charsAt(marks, 9999)).toBe(100);
  });
});

describe("parseMarks", () => {
  it("reads stored marks and rejects anything else", () => {
    expect(parseMarks("[[0,0],[100,5]]")).toEqual([
      [0, 0],
      [100, 5],
    ]);
    expect(parseMarks(null)).toBeNull();
    expect(parseMarks("not json")).toBeNull();
    expect(parseMarks('[["a",1]]')).toBeNull();
    expect(parseMarks("[]")).toBeNull();
  });
});
