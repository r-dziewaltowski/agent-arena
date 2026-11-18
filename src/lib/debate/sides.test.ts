import { describe, expect, it } from "vitest";
import { allowedSides, alternateSides, bothSidesTaken, emptySides, tallySides, type Side } from "./sides";

const entry = (side: Side, position: number, name = `${side}${position}`) => ({ side, position, name });

describe("allowedSides", () => {
  it("offers both sides while more than one slot is free", () => {
    expect(allowedSides([], 2)).toEqual(["for", "against"]);
    expect(allowedSides([entry("for", 1)], 4)).toEqual(["for", "against"]);
    expect(allowedSides([entry("for", 1), entry("for", 2)], 4)).toEqual(["for", "against"]);
  });

  it("keeps the last free slot for the side nobody has taken", () => {
    expect(allowedSides([entry("for", 1)], 2)).toEqual(["against"]);
    expect(allowedSides([entry("against", 1), entry("against", 3)], 3)).toEqual(["for"]);
  });

  it("offers both on the last slot once each side has an agent", () => {
    expect(allowedSides([entry("for", 1), entry("against", 2), entry("for", 3)], 4)).toEqual(["for", "against"]);
  });
});

describe("bothSidesTaken and emptySides", () => {
  it("needs at least one agent on each side", () => {
    expect(bothSidesTaken([])).toBe(false);
    expect(bothSidesTaken([entry("for", 1), entry("for", 2)])).toBe(false);
    expect(emptySides([entry("for", 1), entry("for", 2)])).toEqual(["against"]);
    expect(bothSidesTaken([entry("for", 1), entry("against", 2)])).toBe(true);
  });
});

describe("alternateSides", () => {
  const names = (list: { name: string }[]) => list.map((e) => e.name);

  it("lets For open and the sides take turns, in slot order within each side", () => {
    // Slots 1 and 2 are For, 3 and 4 Against: Ada, Cleo, Bram, Dev.
    const order = alternateSides([entry("for", 1, "Ada"), entry("for", 2, "Bram"), entry("against", 3, "Cleo"), entry("against", 4, "Dev")]);
    expect(names(order)).toEqual(["Ada", "Cleo", "Bram", "Dev"]);
  });

  it("puts For first even when an Against agent holds slot 1", () => {
    expect(names(alternateSides([entry("against", 1, "Cleo"), entry("for", 2, "Ada")]))).toEqual(["Ada", "Cleo"]);
  });

  it("lets the bigger side's remaining agents speak one after another at the end", () => {
    const order = alternateSides([entry("for", 1, "Ada"), entry("against", 2, "Cleo"), entry("for", 3, "Bram"), entry("for", 4, "Eve")]);
    expect(names(order)).toEqual(["Ada", "Cleo", "Bram", "Eve"]);
    const fewerFor = alternateSides([entry("against", 1, "Cleo"), entry("against", 2, "Dev"), entry("for", 3, "Ada")]);
    expect(names(fewerFor)).toEqual(["Ada", "Cleo", "Dev"]);
  });
});

describe("tallySides", () => {
  it("counts side votes, leaving out votes without a side (owners')", () => {
    expect(tallySides([{ side: "against" }, { side: "for" }, { side: "against" }, { side: null }])).toEqual({
      for: 1,
      against: 2,
      total: 3,
      winner: "against",
    });
  });

  it("has no winner on a tie or with no side votes", () => {
    expect(tallySides([{ side: "for" }, { side: "against" }]).winner).toBeNull();
    expect(tallySides([{ side: null }])).toEqual({ for: 0, against: 0, total: 0, winner: null });
  });
});
