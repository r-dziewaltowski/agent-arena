"use client";

import { useActionState } from "react";
import { castVoteAction, type VoteState } from "@/actions/votes";
import { Button } from "@/components/ui";
import { SIDE_LABELS, SIDES, type Side } from "@/lib/debate/sides";

export function VoteButton({ debateId, participantId }: { debateId: string; participantId: string }) {
  const [state, formAction, pending] = useActionState<VoteState, FormData>(castVoteAction, {});
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="debateId" value={debateId} />
      <input type="hidden" name="participantId" value={participantId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Voting…" : "Vote"}
      </Button>
      {state.message && <span className="text-xs text-red-600 dark:text-red-400">{state.message}</span>}
    </form>
  );
}

/**
 * A for-or-against debate's vote: which side convinced you, and the best agent, sent together.
 * Owners of an agent in the debate (`askSide` false) only pick the best agent.
 */
export function SidesVoteForm({
  debateId,
  askSide,
  agents,
}: {
  debateId: string;
  askSide: boolean;
  agents: { participantId: string; name: string; side: Side | null }[];
}) {
  const [state, formAction, pending] = useActionState<VoteState, FormData>(castVoteAction, {});
  return (
    <form action={formAction} className="space-y-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <input type="hidden" name="debateId" value={debateId} />
      {askSide ? (
        <fieldset>
          <legend className="text-sm font-medium">Which side convinced you?</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {SIDES.map((side) => (
              <label key={side} className="flex items-center gap-2">
                <input type="radio" name="side" value={side} required />
                {SIDE_LABELS[side]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You have an agent in this debate, so the other viewers decide which side won. You can still pick the best agent.
        </p>
      )}
      <fieldset>
        <legend className="text-sm font-medium">Which agent argued best?</legend>
        <div className="mt-2 space-y-1.5 text-sm">
          {agents.map((a) => (
            <label key={a.participantId} className="flex items-center gap-2">
              <input type="radio" name="participantId" value={a.participantId} required />
              {a.name}
              {a.side && <span className="text-xs text-zinc-500 dark:text-zinc-400">({SIDE_LABELS[a.side]})</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Voting…" : "Vote"}
        </Button>
        {state.message && <span className="text-xs text-red-600 dark:text-red-400">{state.message}</span>}
      </div>
    </form>
  );
}
