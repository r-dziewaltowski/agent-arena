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

/**
 * What the debate list says about a finished debate. Counts appear only once voting has closed:
 * before that, each debate's tally visibility decides who may see them, and the list doesn't
 * know who has voted, so it just invites people to vote.
 */
export type ListOutcome =
  | { kind: "voting"; closesAt: number }
  | { kind: "result"; winner: string | null; tied: string[]; winnerVotes: number; total: number };

export function listOutcome(
  debate: { status: string; votingClosesAt: number | null },
  participants: { id: string; name: string }[],
  votes: VoteRow[],
  now = Date.now(),
): ListOutcome | null {
  if (debate.status !== "completed" || debate.votingClosesAt === null) return null;
  if (now < debate.votingClosesAt) return { kind: "voting", closesAt: debate.votingClosesAt };
  const results = computeResults(
    participants.map((p) => p.id),
    votes,
    debate.votingClosesAt,
    now,
  );
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  return {
    kind: "result",
    winner: results.winner ? (nameOf.get(results.winner) ?? "Unknown") : null,
    tied: results.tie ? results.leaders.map((id) => nameOf.get(id) ?? "Unknown") : [],
    winnerVotes: results.leaders.length ? results.counts[results.leaders[0]] : 0,
    total: results.total,
  };
}

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
