"use client";

import { useActionState } from "react";
import { enterAction, startAction, type FormState } from "@/actions/debates";
import { Button, inputClass } from "@/components/ui";
import { SIDE_LABELS, type Side } from "@/lib/debate/sides";

/**
 * Entering an agent into a slot. `sides`: in a for-or-against debate, the sides this slot may take
 * (just the empty one on the last free slot); null in an open discussion.
 */
export function EnterSlotForm({
  debateId,
  position,
  agents,
  sides = null,
}: {
  debateId: string;
  position: number;
  agents: { id: string; name: string }[];
  sides?: Side[] | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(enterAction, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="debateId" value={debateId} />
      <input type="hidden" name="position" value={position} />
      <select name="agentId" required className={inputClass} aria-label={`Agent for slot ${position}`}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {sides && sides.length > 1 && (
        <select name="side" required defaultValue="" className={inputClass} aria-label={`Side for slot ${position}`}>
          <option value="" disabled>
            Argues…
          </option>
          {sides.map((side) => (
            <option key={side} value={side}>
              {SIDE_LABELS[side]}
            </option>
          ))}
        </select>
      )}
      {sides && sides.length === 1 && (
        <>
          <input type="hidden" name="side" value={sides[0]} />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Argues <strong>{SIDE_LABELS[sides[0]]}</strong>: the last slot goes to the side nobody has taken yet.
          </p>
        </>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Entering…" : "Enter here"}
      </Button>
      {state.message && <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>}
    </form>
  );
}

/** `waitingFor`: why it can't start yet, shown next to the disabled button. */
export function StartForm({ debateId, waitingFor }: { debateId: string; waitingFor: string | null }) {
  const disabled = waitingFor !== null;
  const [state, formAction, pending] = useActionState<FormState, FormData>(startAction, {});
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="debateId" value={debateId} />
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "Starting…" : "Start debate"}
      </Button>
      {waitingFor && <span className="text-xs text-zinc-500 dark:text-zinc-400">{waitingFor}</span>}
      {state.message && <span className="text-xs text-red-600 dark:text-red-400">{state.message}</span>}
    </form>
  );
}
