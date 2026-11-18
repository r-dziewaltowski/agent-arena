import Link from "next/link";
import { Card, cx } from "@/components/ui";
import type { DebateRow, SlotEntry } from "@/lib/debate-view";
import { canSeeTally } from "@/lib/debate/lifecycle";
import { computeResults, type VoteRow } from "@/lib/debate/results";
import { SIDE_LABELS, SIDES, tallySides, type SideTally } from "@/lib/debate/sides";
import { Countdown } from "./countdown";
import { SideBadge } from "./side-badge";
import { SidesVoteForm, VoteButton } from "./vote-button";

/**
 * Voting on a finished debate: who you can vote for (never your own agents), the countdown to
 * close, and the tally, shown according to the debate's visibility rule. Provisional while
 * voting is open, final once it closes. A for-or-against debate also asks which side convinced
 * each voter (except owners of an agent in it), and leads with that result.
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
  const sides = debate.mode === "sides";
  const sideTally = sides ? tallySides(votes.map((v) => ({ side: v.side ?? null }))) : null;
  const vote = viewerId ? (votes.find((v) => v.userId === viewerId) ?? null) : null;
  const myVote = vote?.participantId ?? null;
  const showTally = canSeeTally(debate, { hasVoted: myVote !== null }, now);
  const open = !results.final;
  const nameOf = (id: string) => slots.find((s) => s.participantId === id)?.name ?? "Unknown";
  const isOwner = viewerId !== null && slots.some((s) => s.userId === viewerId);

  // Whether this viewer can still vote: signed in, not voted yet, and at least one agent isn't theirs.
  const canVote = open && viewerId !== null && myVote === null && slots.some((s) => s.userId !== viewerId);
  let title: string;
  if (!open) title = "Final result";
  else if (myVote) title = "Thanks for voting";
  else if (canVote) title = sides ? "Which side won? Vote now" : "Who won? Vote now";
  else title = sides ? "Which side won?" : "Who won?";

  const hidden = "Results are revealed " + (debate.tallyVisibility === "after_vote" ? "once you vote, or when voting closes." : "when voting closes.");
  let headline: string;
  if (!showTally) headline = hidden;
  else if (results.total === 0) headline = open ? "No votes yet." : "Voting closed with no votes.";
  else if (results.winner) headline = `${open ? "Leading" : "Winner"}: ${nameOf(results.winner)}`;
  else headline = `${open ? "Currently tied" : "Tie"}: ${results.leaders.map(nameOf).join(" and ")}`;
  if (sides && showTally && results.total > 0) headline = `Best agent: ${headline.replace(/^(Leading|Winner): /, "")}`;

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

      {sideTally && (
        <SideResult tally={sideTally} show={showTally} open={open} mySide={vote?.side ?? null} hiddenText={hidden} />
      )}

      <p className={cx("text-sm", results.winner && showTally ? "font-medium" : "text-zinc-600 dark:text-zinc-400")}>
        {sides && !showTally ? "Best agent: hidden for now." : headline}
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
                    {s.side && (
                      <span className="ml-2">
                        <SideBadge side={s.side} />
                      </span>
                    )}
                    {myVote === s.participantId && <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">your vote</span>}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">by {s.ownerName}</p>
                </div>
                {showTally && (
                  <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                    {count} vote{count === 1 ? "" : "s"}
                  </span>
                )}
                {!sides && open && viewerId && myVote === null && !own && <VoteButton debateId={debate.id} participantId={s.participantId} />}
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

      {sides && canVote && (
        <SidesVoteForm
          debateId={debate.id}
          askSide={!isOwner}
          agents={slots.filter((s) => s.userId !== viewerId).map((s) => ({ participantId: s.participantId, name: s.name, side: s.side }))}
        />
      )}

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

/** "Against won, 7–4": the side vote, with a bar for each side. */
function SideResult({
  tally,
  show,
  open,
  mySide,
  hiddenText,
}: {
  tally: SideTally;
  show: boolean;
  open: boolean;
  mySide: string | null;
  hiddenText: string;
}) {
  if (!show) return <p className="text-sm text-zinc-600 dark:text-zinc-400">Which side won: {hiddenText.charAt(0).toLowerCase() + hiddenText.slice(1)}</p>;
  let line: string;
  if (tally.total === 0) line = open ? "No side votes yet." : "Voting closed with no side votes.";
  else if (!tally.winner) line = `${open ? "The sides are level" : "The sides tied"}, ${tally.for}–${tally.against}`;
  else {
    const [w, l] = tally.winner === "for" ? [tally.for, tally.against] : [tally.against, tally.for];
    line = `${SIDE_LABELS[tally.winner]} ${open ? "leads" : "won"}, ${w}–${l}`;
  }
  return (
    <div className="space-y-2">
      <p className="text-base font-semibold">
        {line}
        {open && tally.total > 0 && <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400"> (provisional)</span>}
      </p>
      {tally.total > 0 && (
        <div className="space-y-1.5">
          {SIDES.map((side) => {
            const count = tally[side];
            return (
              <div key={side} className="flex items-center gap-3 text-sm">
                <span className="w-16">
                  <SideBadge side={side} />
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={cx("h-full", side === "for" ? "bg-sky-500" : "bg-orange-500")}
                    style={{ width: `${Math.round((count / tally.total) * 100)}%` }}
                  />
                </div>
                <span className="w-24 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {count} vote{count === 1 ? "" : "s"}
                  {mySide === side && <span className="ml-1 text-xs text-indigo-600 dark:text-indigo-400">· yours</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
