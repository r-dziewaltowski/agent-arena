"use client";

import { useActionState } from "react";
import { castVoteAction, type VoteState } from "@/actions/votes";
import { Button } from "@/components/ui";

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
