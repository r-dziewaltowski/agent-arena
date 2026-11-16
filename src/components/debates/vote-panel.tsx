import Link from "next/link";
import { Card, cx } from "@/components/ui";
import type { DebateRow, SlotEntry } from "@/lib/debate-view";
import { canSeeTally } from "@/lib/debate/lifecycle";
import { computeResults, type VoteRow } from "@/lib/debate/results";
import { Countdown } from "./countdown";
import { VoteButton } from "./vote-button";

/**
 * Voting on a finished debate: who you can vote for (never your own agents), the countdown to
 * close, and the tally, shown according to the debate's visibility rule. Provisional while
 * voting is open, final once it closes.
 */
export function VotePanel({
  debate,
  slots,
  votes,
  viewerId,
  now,
}: {
  debate: DebateRow;
  slots: SlotEntry[];
  votes: VoteRow[];
  viewerId: string | null;
  now: number;
}) {
  const results = computeResults(
    slots.map((s) => s.participantId),
    votes,
    debate.votingClosesAt,
    now,
  );
  const myVote = viewerId ? votes.find((v) => v.userId === viewerId)?.participantId ?? null : null;
  const showTally = canSeeTally(debate, { hasVoted: myVote !== null }, now);
  const open = !results.final;
  const nameOf = (id: string) => slots.find((s) => s.participantId === id)?.name ?? "Unknown";

  // Whether this viewer can still vote: signed in, not voted yet, and at least one agent isn't theirs.
  const canVote = open && viewerId !== null && myVote === null && slots.some((s) => s.userId !== viewerId);
  let title: string;
  if (!open) title = "Final result";
  else if (myVote) title = "Thanks for voting";
  else if (canVote) title = "Who won? Vote now";
  else title = "Who won?";

  let headline: string;
  if (!showTally) headline = "Results are revealed " + (debate.tallyVisibility === "after_vote" ? "once you vote, or when voting closes." : "when voting closes.");
  else if (results.total === 0) headline = open ? "No votes yet." : "Voting closed with no votes.";
  else if (results.winner) headline = `${open ? "Leading" : "Winner"}: ${nameOf(results.winner)}`;
  else headline = `${open ? "Currently tied" : "Tie"}: ${results.leaders.map(nameOf).join(" and ")}`;

  return (
    <Card className="mt-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {open && debate.votingClosesAt && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            <Countdown to={debate.votingClosesAt} label="Voting closes in" />
          </span>
        )}
      </div>
      <p className={cx("text-sm", results.winner && showTally ? "font-medium" : "text-zinc-600 dark:text-zinc-400")}>
        {headline}
        {showTally && open && results.total > 0 && <span className="text-zinc-500 dark:text-zinc-400"> (provisional)</span>}
      </p>

      <ul className="space-y-2">
        {slots.map((s) => {
          const own = viewerId !== null && s.userId === viewerId;
          const count = results.counts[s.participantId] ?? 0;
          const pct = results.total > 0 ? Math.round((count / results.total) * 100) : 0;
          return (
            <li key={s.participantId} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {s.name}
                    {myVote === s.participantId && <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">your vote</span>}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">by {s.ownerName}</p>
                </div>
                {showTally && (
                  <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                    {count} vote{count === 1 ? "" : "s"}
                  </span>
                )}
                {open && viewerId && myVote === null && !own && <VoteButton debateId={debate.id} participantId={s.participantId} />}
                {open && own && <span className="text-xs text-zinc-500 dark:text-zinc-400">Your agent</span>}
              </div>
              {showTally && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {open && !viewerId && (
        <p className="text-sm">
          <Link href={`/sign-in?next=/debates/${debate.id}`} className="font-medium text-indigo-600 hover:underline">
            Sign in
          </Link>{" "}
          to vote.
        </p>
      )}
    </Card>
  );
}
