import { describe, expect, it } from "vitest";
import { toTurnView, viewTurns } from "../debate-view";
import type { turns } from "../db/schema";
import type { Mark } from "../voice/marks";
import {
  nextPrepareAt,
  PAUSE_BETWEEN_TURNS_MS,
  PREPARE_AHEAD_MS,
  readingWordsPerSecond,
  revealDurationMs,
  revealedLength,
  SPEECH_PLAYBACK_RATE,
  turnRevealEndsAt,
  wholeWords,
} from "./pacing";

const T0 = 1_700_000_000_000;
const TEXT = "One two three four five six seven eight nine.";

describe("reading pace", () => {
  it("defaults to 4.5 words a second, can be overridden, and \"0\" turns it off", () => {
    expect(readingWordsPerSecond({})).toBe(4.5);
    expect(readingWordsPerSecond({ DEBATE_READING_WORDS_PER_SECOND: "40" })).toBe(40);
    expect(readingWordsPerSecond({ DEBATE_READING_WORDS_PER_SECOND: "nonsense" })).toBe(4.5);
    expect(readingWordsPerSecond({ DEBATE_READING_WORDS_PER_SECOND: "0" })).toBeNull();
  });

  it("releases whole words at the reading pace", () => {
    const at = (ms: number) => TEXT.slice(0, revealedLength(TEXT, { revealStartedAt: T0 }, T0 + ms, 2));
    expect(revealedLength(TEXT, { revealStartedAt: null }, T0, 2)).toBe(TEXT.length); // not paced
    expect(at(400)).toBe("");
    expect(at(1000)).toBe("One two");
    expect(at(2600)).toBe("One two three four five");
    expect(at(4500)).toBe(TEXT);
    expect(at(-1000)).toBe(""); // not started yet (a turn prepared ahead, or clocks slightly apart)
  });

  it("follows the speech's marks when the turn has a voice, at playback speed", () => {
    // "One two three four five" spoken over the first second, a pause, the rest over the next.
    const marks: Mark[] = [
      [0, 0],
      [1000, 23],
      [1500, 23],
      [2500, TEXT.length],
    ];
    const at = (ms: number) => TEXT.slice(0, revealedLength(TEXT, { revealStartedAt: T0, marks }, T0 + ms, 2));
    expect(at(0)).toBe("");
    expect(at(500 / SPEECH_PLAYBACK_RATE)).toBe("One two"); // half way through the first sentence: 11 of 23 characters
    expect(at(1200 / SPEECH_PLAYBACK_RATE)).toBe("One two three four five"); // in the pause
    expect(at(2500 / SPEECH_PLAYBACK_RATE)).toBe(TEXT);
  });

  it("only ever shows whole words", () => {
    expect(TEXT.slice(0, wholeWords(TEXT, 5))).toBe("One"); // "One t" → "One"
    expect(TEXT.slice(0, wholeWords(TEXT, 7))).toBe("One two");
    expect(wholeWords(TEXT, 0)).toBe(0);
    expect(wholeWords(TEXT, 999)).toBe(TEXT.length);
  });

  it("times a turn by its speech, or by its words at reading pace", () => {
    expect(revealDurationMs(TEXT, 2, null)).toBe(4500);
    expect(revealDurationMs(TEXT, 2, [[0, 0], [6000, TEXT.length]])).toBe(Math.ceil(6000 / SPEECH_PLAYBACK_RATE));
    expect(turnRevealEndsAt({ content: TEXT, revealStartedAt: T0, revealEndsAt: T0 + 9000 }, 2)).toBe(T0 + 9000);
    // Turns from before this was stored: worked out from the words.
    expect(turnRevealEndsAt({ content: TEXT, revealStartedAt: T0, revealEndsAt: null }, 2)).toBe(T0 + 4500);
    expect(turnRevealEndsAt({ content: TEXT, revealStartedAt: null, revealEndsAt: null }, 2)).toBeNull();
  });

  it("prepares the next turn shortly before this one has been shown", () => {
    const end = T0 + 60_000;
    expect(nextPrepareAt(end, T0)).toBe(end + PAUSE_BETWEEN_TURNS_MS - PREPARE_AHEAD_MS);
    expect(nextPrepareAt(T0 + 10_000, T0)).toBeNull(); // short turn: straight away
    expect(nextPrepareAt(null, T0)).toBeNull(); // pacing off
  });
});

describe("toTurnView", () => {
  const row: typeof turns.$inferSelect = {
    id: "t1",
    debateId: "d1",
    participantId: "p1",
    round: 1,
    seq: 1,
    kind: "opening",
    status: "complete",
    content: TEXT,
    promptTokens: 100,
    completionTokens: 20,
    modelId: "m",
    latencyMs: 900,
    finishReason: "stop",
    revealStartedAt: T0,
    revealEndsAt: T0 + 4500,
    audioMarks: null,
    createdAt: T0,
    updatedAt: T0,
  };

  it("shows a finished turn as still being written until all of it has been revealed", () => {
    expect(toTurnView(row, T0 + 1000, 2)).toMatchObject({ status: "streaming", content: "One two", completionTokens: null });
    expect(toTurnView(row, T0 + 1000, 2)?.reveal).toEqual({ startsAt: T0, full: TEXT, marks: null, audioUrl: null });
    expect(toTurnView(row, T0 + 5000, 2)).toMatchObject({ status: "complete", content: TEXT, completionTokens: 20, reveal: null });
  });

  it("points a spoken turn at its audio while it's being shown", () => {
    const spoken = { ...row, audioMarks: JSON.stringify([[0, 0], [5000, TEXT.length]]) };
    expect(toTurnView(spoken, T0 + 1000, 2)?.reveal).toMatchObject({ audioUrl: "/api/debates/d1/turns/t1/audio" });
  });

  it("hides a turn until it starts, and turns still being written", () => {
    expect(toTurnView(row, T0 - 1, 2)).toBeNull();
    expect(toTurnView({ ...row, status: "streaming", revealStartedAt: null }, T0, 2)).toBeNull();
    // Without pacing, a turn shows as it's written.
    expect(toTurnView({ ...row, status: "streaming", revealStartedAt: null }, T0, null)).toMatchObject({ status: "streaming" });
  });

  it("shows unpaced turns as they are", () => {
    expect(toTurnView({ ...row, revealStartedAt: null }, T0, 2)).toMatchObject({ status: "complete", content: TEXT });
  });

  it("says which turn comes next while it's waiting, so its speech can load", () => {
    const next = { ...row, id: "t2", seq: 2, revealStartedAt: T0 + 6000, audioMarks: "[[0,0],[1000,5]]" };
    const { turns: visible, upcoming } = viewTurns([row, next], T0 + 1000, 2);
    expect(visible.map((t) => t.seq)).toEqual([1]);
    expect(upcoming).toEqual({ seq: 2, startsAt: T0 + 6000, audioUrl: "/api/debates/d1/turns/t2/audio" });
    expect(viewTurns([row, next], T0 + 7000, 2).upcoming).toBeNull();
  });
});
