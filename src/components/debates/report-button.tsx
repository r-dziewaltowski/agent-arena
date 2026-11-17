"use client";

import { useActionState, useRef } from "react";
import { reportAction, type ReportFormState } from "@/actions/reports";
import { Button, Field, inputClass, Notice } from "@/components/ui";
import { REPORT_NOTE_MAX_LENGTH, REPORT_REASONS } from "@/lib/reports-shared";

export type ReportChoice = { value: string; label: string };

/**
 * "Report" on a debate: says what's wrong (the topic, one turn, or an agent's name or picture) and
 * why. Admins get an email and review it; nothing is hidden automatically.
 */
export function ReportButton({ debateId, choices }: { debateId: string; choices: ReportChoice[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<ReportFormState, FormData>(reportAction, {});

  return (
    <>
      <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => dialog.current?.showModal()}>
        <FlagIcon />
        Report
      </Button>
      <dialog
        ref={dialog}
        aria-label="Report this debate"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        {state.sent ? (
          <div className="space-y-4">
            <h2 className="font-semibold">Thanks for the report</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">An admin will review it and act if it breaks the rules.</p>
            <div className="flex justify-end">
              <Button type="button" autoFocus onClick={() => dialog.current?.close()}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <h2 className="font-semibold">Report a problem</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Only admins see reports. Nothing is hidden until an admin has looked at it.
            </p>
            {state.message && <Notice tone="red">{state.message}</Notice>}
            <input type="hidden" name="debateId" value={debateId} />
            <Field label="What's the problem with?">
              <select name="about" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose…
                </option>
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Why?">
              <select name="reason" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose…
                </option>
                {Object.entries(REPORT_REASONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Anything to add? (optional)">
              <textarea name="note" rows={3} maxLength={REPORT_NOTE_MAX_LENGTH} className={inputClass} />
            </Field>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Send report"}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="mr-1 inline size-3.5 -translate-y-px" aria-hidden>
      <path d="M5 17V3m0 1h9l-2 3.5 2 3.5H5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
