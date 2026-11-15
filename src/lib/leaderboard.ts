/**
 * Leaderboard standings, from debates whose voting has closed (final results only).
 *
 * - A win is one participant alone with the most votes; a shared top count is a tie; a debate
 *   nobody voted on counts as played with no winner.
 * - Agents: one row per agent still in existence (deleted agents drop off). Debates between two
 *   agents of the same owner count, since other users' votes decide them.
 * - Users: a debate counts only if at least two different users had agents in it. Several agents
 *   of one user in a debate count once: a win if all top-voted agents are theirs, a tie if the top
 *   is shared with someone else, and the votes of all their agents add up. Debates with an agent
 *   deleted since still count for its owner.
 *
 * Ranking: most wins, then higher win rate, then more votes received. Rows equal on all three
 * share a rank.
 */
import { computeResults } from "./debate/results";

export type FinalDebate = {
  id: string;
  votingClosesAt: number;
  participants: { id: string; agentId: string | null; userId: string }[];
  votes: { participantId: string; userId: string }[];
};

export type Standing = { debates: number; wins: number; ties: number; votes: number };
export type Ranked<K> = Standing & { key: K; rank: number; winRate: number };

const empty = (): Standing => ({ debates: 0, wins: 0, ties: 0, votes: 0 });

function resultsOf(d: FinalDebate) {
  // The debates passed in are final by construction, so the clock doesn't matter here.
  return computeResults(
    d.participants.map((p) => p.id),
    d.votes,
    d.votingClosesAt,
    d.votingClosesAt,
  );
}

export function agentStandings(debates: FinalDebate[]): Map<string, Standing> {
  const table = new Map<string, Standing>();
  for (const d of debates) {
    const r = resultsOf(d);
    for (const p of d.participants) {
      if (!p.agentId) continue;
      const s = table.get(p.agentId) ?? empty();
      s.debates += 1;
      s.votes += r.counts[p.id] ?? 0;
      if (r.winner === p.id) s.wins += 1;
      else if (r.tie && r.leaders.includes(p.id)) s.ties += 1;
      table.set(p.agentId, s);
    }
  }
  return table;
}

export function userStandings(debates: FinalDebate[]): Map<string, Standing> {
  const table = new Map<string, Standing>();
  for (const d of debates) {
    const users = [...new Set(d.participants.map((p) => p.userId))];
    if (users.length < 2) continue; // no opponent
    const r = resultsOf(d);
    const ownerOf = new Map(d.participants.map((p) => [p.id, p.userId]));
    const leaderUsers = new Set(r.leaders.map((id) => ownerOf.get(id)));
    for (const user of users) {
      const s = table.get(user) ?? empty();
      s.debates += 1;
      s.votes += d.participants.filter((p) => p.userId === user).reduce((sum, p) => sum + (r.counts[p.id] ?? 0), 0);
      if (leaderUsers.has(user)) {
        if (leaderUsers.size === 1) s.wins += 1;
        else s.ties += 1;
      }
      table.set(user, s);
    }
  }
  return table;
}

/** Sorts standings by wins, win rate, then votes, and numbers them (equal rows share a rank). */
export function rank<K>(table: Map<K, Standing>): Ranked<K>[] {
  const rows = [...table.entries()].map(([key, s]) => ({
    key,
    ...s,
    winRate: s.debates ? s.wins / s.debates : 0,
    rank: 0,
  }));
  rows.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.votes - a.votes);
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank =
      prev && prev.wins === row.wins && prev.winRate === row.winRate && prev.votes === row.votes ? prev.rank : i + 1;
  });
  return rows;
}
