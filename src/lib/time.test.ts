import { describe, expect, it } from "vitest";
import { localToEpoch } from "./time";

describe("localToEpoch", () => {
  it("converts a local time in a fixed-offset zone", () => {
    // Kuala Lumpur is UTC+8 all year.
    expect(localToEpoch("2026-11-20T18:30", "Asia/Kuala_Lumpur")).toBe(Date.UTC(2026, 10, 20, 10, 30));
  });

  it("follows daylight saving time", () => {
    // Warsaw: UTC+1 in winter, UTC+2 in summer.
    expect(localToEpoch("2026-01-15T12:00", "Europe/Warsaw")).toBe(Date.UTC(2026, 0, 15, 11, 0));
    expect(localToEpoch("2026-07-15T12:00", "Europe/Warsaw")).toBe(Date.UTC(2026, 6, 15, 10, 0));
  });

  it("treats an unknown zone as UTC and rejects malformed input", () => {
    expect(localToEpoch("2026-11-20T18:30", "Not/AZone")).toBe(Date.UTC(2026, 10, 20, 18, 30));
    expect(localToEpoch("tomorrow", "UTC")).toBeNull();
    expect(localToEpoch("", "UTC")).toBeNull();
  });
});
