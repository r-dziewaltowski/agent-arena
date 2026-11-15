import { describe, expect, it } from "vitest";
import { agentStandings, rank, userStandings, type FinalDebate } from "./leaderboard";

let n = 0;
/** A debate: entries are [agentId | null, userId]; votes name the entry index each voter chose. */
function debate(entries: [string | null, string][], votes: number[]): FinalDebate {
  const id = `d${++n}`;
  const participants = entries.map(([agentId, userId], i) => ({ id: `${id}-p${i}`, agentId, userId }));
  return {
    id,
    votingClosesAt: 1000,
    participants,
    votes: votes.map((i, v) => ({ participantId: participants[i].id, userId: `voter${v}` })),
  };
}

describe("agentStandings", () => {
  it("counts debates, outright wins, ties, unvoted debates and votes", () => {
    const table = agentStandings([
      debate([["a", "ann"], ["b", "bob"]], [0, 0, 1]), // a wins 2-1
      debate([["a", "ann"], ["b", "bob"]], [0, 1]), // tie
      debate([["a", "ann"], ["b", "bob"]], []), // nobody voted
    ]);
    expect(table.get("a")).toEqual({ debates: 3, wins: 1, ties: 1, votes: 3 });
    expect(table.get("b")).toEqual({ debates: 3, wins: 0, ties: 1, votes: 2 });
  });

  it("leaves out deleted agents but counts same-owner debates", () => {
    const table = agentStandings([debate([[null, "ann"], ["b", "ann"]], [1])]);
    expect([...table.keys()]).toEqual(["b"]);
    expect(table.get("b")).toEqual({ debates: 1, wins: 1, ties: 0, votes: 1 });
  });
});

describe("userStandings", () => {
  it("skips debates without an opponent", () => {
    expect(userStandings([debate([["a", "ann"], ["b", "ann"]], [0])]).size).toBe(0);
  });

  it("counts a user's several agents once, adding their votes", () => {
    const table = userStandings([debate([["a", "ann"], ["a2", "ann"], ["b", "bob"]], [0, 0, 1, 2])]);
    expect(table.get("ann")).toEqual({ debates: 1, wins: 1, ties: 0, votes: 3 });
    expect(table.get("bob")).toEqual({ debates: 1, wins: 0, ties: 0, votes: 1 });
  });

  it("treats a top shared only by one user's agents as their win, and a cross-user top as a tie", () => {
    const ownTie = userStandings([debate([["a", "ann"], ["a2", "ann"], ["b", "bob"]], [0, 1])]);
    expect(ownTie.get("ann")?.wins).toBe(1);
    const crossTie = userStandings([debate([["a", "ann"], ["b", "bob"], ["c", "cat"]], [0, 1])]);
    expect(crossTie.get("ann")).toMatchObject({ wins: 0, ties: 1 });
    expect(crossTie.get("bob")).toMatchObject({ wins: 0, ties: 1 });
    expect(crossTie.get("cat")).toMatchObject({ wins: 0, ties: 0, debates: 1 });
  });

  it("keeps debates of agents deleted since", () => {
    const table = userStandings([debate([[null, "ann"], ["b", "bob"]], [0])]);
    expect(table.get("ann")).toEqual({ debates: 1, wins: 1, ties: 0, votes: 1 });
  });
});

describe("rank", () => {
  it("orders by wins, then win rate, then votes, sharing ranks only on full ties", () => {
    const table = new Map([
      ["many", { debates: 10, wins: 3, ties: 0, votes: 9 }],
      ["efficient", { debates: 3, wins: 3, ties: 0, votes: 5 }],
      ["one", { debates: 1, wins: 1, ties: 0, votes: 2 }],
      ["oneToo", { debates: 1, wins: 1, ties: 0, votes: 2 }],
      ["none", { debates: 2, wins: 0, ties: 1, votes: 1 }],
    ]);
    const ranked = rank(table);
    expect(ranked.map((r) => [r.key, r.rank])).toEqual([
      ["efficient", 1],
      ["many", 2],
      ["one", 3],
      ["oneToo", 3],
      ["none", 5],
    ]);
    expect(ranked[0].winRate).toBe(1);
  });
});
