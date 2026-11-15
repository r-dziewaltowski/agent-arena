/**
 * Vote counting. Pure functions, so the rules are easy to test: one vote per user (enforced on
 * write), the result is provisional while voting is open and final once it closes.
 */

export type VoteRow = { participantId: string; userId: string };

export type Results = {
  /** Votes per participant id (participants with no votes have 0). */
  counts: Record<string, number>;
  total: number;
  /** Participant ids sharing the highest count (empty when nobody has voted). */
  leaders: string[];
  /** One clear leader with at least one vote. */
  winner: string | null;
  tie: boolean;
  /** Voting has closed, so the result can no longer change. */
  final: boolean;
};

export function computeResults(
  participantIds: string[],
  votes: VoteRow[],
  votingClosesAt: number | null,
  now = Date.now(),
): Results {
  const counts: Record<string, number> = Object.fromEntries(participantIds.map((id) => [id, 0]));
  for (const v of votes) if (v.participantId in counts) counts[v.participantId] += 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? participantIds.filter((id) => counts[id] === max) : [];
  return {
    counts,
    total,
    leaders,
    winner: leaders.length === 1 ? leaders[0] : null,
    tie: leaders.length > 1,
    final: votingClosesAt !== null && now >= votingClosesAt,
  };
}
