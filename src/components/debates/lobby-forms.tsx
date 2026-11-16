"use client";

import { useActionState } from "react";
import { enterAction, startAction, type FormState } from "@/actions/debates";
import { Button, inputClass } from "@/components/ui";

export function EnterSlotForm({
  debateId,
  position,
  agents,
}: {
  debateId: string;
  position: number;
  agents: { id: string; name: string }[];
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
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Entering…" : "Enter here"}
      </Button>
      {state.message && <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>}
    </form>
  );
}

export function StartForm({ debateId, disabled }: { debateId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(startAction, {});
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="debateId" value={debateId} />
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "Starting…" : "Start debate"}
      </Button>
      {disabled && <span className="text-xs text-zinc-500 dark:text-zinc-400">Needs at least 2 agents.</span>}
      {state.message && <span className="text-xs text-red-600 dark:text-red-400">{state.message}</span>}
    </form>
  );
}
