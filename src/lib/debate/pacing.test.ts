import { describe, expect, it } from "vitest";
import { toTurnView } from "../debate-view";
import type { turns } from "../db/schema";
import { nextTurnAt, PAUSE_BETWEEN_TURNS_MS, readingWordsPerSecond, revealedLength, revealEndsAt } from "./pacing";

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
    expect(revealedLength(TEXT, null, T0, 2)).toBe(TEXT.length); // not paced
    expect(revealedLength(TEXT, T0, T0 + 400, 2)).toBe(0);
    expect(TEXT.slice(0, revealedLength(TEXT, T0, T0 + 1000, 2))).toBe("One two");
    expect(TEXT.slice(0, revealedLength(TEXT, T0, T0 + 2600, 2))).toBe("One two three four five");
    expect(revealedLength(TEXT, T0, T0 + 4500, 2)).toBe(TEXT.length);
    expect(revealedLength(TEXT, T0, T0 - 1000, 2)).toBe(0); // clocks slightly apart
  });

  it("starts the next turn once the text has been shown, plus a pause", () => {
    expect(revealEndsAt(TEXT, T0, 2)).toBe(T0 + 4500);
    expect(nextTurnAt(TEXT, T0, T0 + 1000, 2)).toBe(T0 + 4500 + PAUSE_BETWEEN_TURNS_MS);
    expect(nextTurnAt(TEXT, null, T0, 2)).toBeNull(); // not paced
    expect(nextTurnAt(TEXT, T0, T0, null)).toBeNull(); // pacing off
    expect(nextTurnAt(TEXT, T0, T0 + 60_000, 2)).toBeNull(); // already read (a slow model)
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
    createdAt: T0,
    updatedAt: T0,
  };

  it("shows a finished turn as still being written until all of it has been revealed", () => {
    expect(toTurnView(row, T0 + 1000, 2)).toMatchObject({ status: "streaming", content: "One two", completionTokens: null });
    expect(toTurnView(row, T0 + 5000, 2)).toMatchObject({ status: "complete", content: TEXT, completionTokens: 20 });
  });

  it("shows unpaced turns as they are", () => {
    expect(toTurnView({ ...row, revealStartedAt: null }, T0, 2)).toMatchObject({ status: "complete", content: TEXT });
  });
});
