import { describe, expect, it } from "vitest";
import { computeResults, listOutcome } from "./results";

const NOW = 1_700_000_000_000;

describe("computeResults", () => {
  it("has no winner and is provisional before anyone votes", () => {
    expect(computeResults(["a", "b"], [], NOW + 1000, NOW)).toEqual({
      counts: { a: 0, b: 0 },
      total: 0,
      leaders: [],
      winner: null,
      tie: false,
      final: false,
    });
  });

  it("picks a clear winner", () => {
    const r = computeResults(["a", "b", "c"], [
      { participantId: "b", userId: "u1" },
      { participantId: "b", userId: "u2" },
      { participantId: "a", userId: "u3" },
    ], NOW + 1000, NOW);
    expect(r).toMatchObject({ counts: { a: 1, b: 2, c: 0 }, total: 3, winner: "b", tie: false });
  });

  it("reports a tie between the leaders", () => {
    const r = computeResults(["a", "b", "c"], [
      { participantId: "a", userId: "u1" },
      { participantId: "b", userId: "u2" },
    ], NOW + 1000, NOW);
    expect(r).toMatchObject({ leaders: ["a", "b"], winner: null, tie: true });
  });

  it("becomes final once voting closes", () => {
    expect(computeResults(["a"], [], NOW, NOW).final).toBe(true);
    expect(computeResults(["a"], [], NOW + 1, NOW).final).toBe(false);
    expect(computeResults(["a"], [], null, NOW).final).toBe(false);
  });

  it("ignores votes for participants not in the debate", () => {
    expect(computeResults(["a"], [{ participantId: "zzz", userId: "u1" }], null, NOW).total).toBe(0);
  });
});

describe("listOutcome", () => {
  const people = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bram" },
    { id: "c", name: "Cleo" },
  ];
  const vote = (participantId: string, userId: string) => ({ participantId, userId });
  const closed = { status: "completed", votingClosesAt: NOW - 1 };

  it("says nothing for debates that haven't finished", () => {
    expect(listOutcome({ status: "running", votingClosesAt: null }, people, [], NOW)).toBeNull();
    expect(listOutcome({ status: "failed", votingClosesAt: null }, people, [], NOW)).toBeNull();
  });

  it("only invites a vote while voting is open, never showing counts", () => {
    expect(listOutcome({ status: "completed", votingClosesAt: NOW + 1000 }, people, [vote("a", "u1")], NOW)).toEqual({
      kind: "voting",
      closesAt: NOW + 1000,
    });
  });

  it("names the winner with their votes once voting has closed", () => {
    expect(listOutcome(closed, people, [vote("a", "u1"), vote("a", "u2"), vote("b", "u3")], NOW)).toEqual({
      kind: "result",
      winner: "Ada",
      tied: [],
      winnerVotes: 2,
      total: 3,
    });
  });

  it("names everyone tied for the lead, and reports no votes", () => {
    expect(listOutcome(closed, people, [vote("a", "u1"), vote("c", "u2")], NOW)).toMatchObject({ winner: null, tied: ["Ada", "Cleo"], winnerVotes: 1 });
    expect(listOutcome(closed, people, [], NOW)).toMatchObject({ kind: "result", winner: null, tied: [], total: 0 });
  });
});
