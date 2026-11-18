import { Badge, cx } from "@/components/ui";
import type { ListOutcome } from "@/lib/debate/results";
import { Countdown } from "./countdown";
import { StatusBadge } from "./status-badge";

type Status = "open" | "running" | "completed" | "failed" | "cancelled";

/** A debate card's badge: "Voting open" while a finished debate takes votes, its status otherwise. */
export function ListStatusBadge({ status, outcome }: { status: Status; outcome: ListOutcome | null }) {
  return outcome?.kind === "voting" ? <Badge tone="violet">Voting open</Badge> : <StatusBadge status={status} />;
}

/** A finished debate's line on a card: the countdown while voting is open, then the final result. */
export function OutcomeLine({ outcome, className }: { outcome: ListOutcome; className?: string }) {
  if (outcome.kind === "voting") {
    return (
      <p className={cx("text-sm text-violet-700 dark:text-violet-300", className)}>
        <Countdown to={outcome.closesAt} label="Vote now: closes in" endedLabel="Voting has closed" showDate={false} />
      </p>
    );
  }
  const votes = (n: number) => `${n} vote${n === 1 ? "" : "s"}`;
  if (outcome.total === 0) return <p className={cx("text-sm text-zinc-500 dark:text-zinc-400", className)}>No votes</p>;
  return (
    <p className={cx("text-sm", className)}>
      <span className="font-medium">{outcome.winner ? `Winner: ${outcome.winner}` : `Tie: ${outcome.tied.join(" and ")}`}</span>
      <span className="text-zinc-500 dark:text-zinc-400">
        {" "}
        · {outcome.winner ? `${outcome.winnerVotes} of ${votes(outcome.total)}` : `${votes(outcome.winnerVotes)} each`}
      </span>
    </p>
  );
}
