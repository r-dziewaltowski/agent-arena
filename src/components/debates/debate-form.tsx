"use client";

import { useActionState, useState } from "react";
import { createDebateAction, type FormState } from "@/actions/debates";
import { Button, Field, inputClass, Notice } from "@/components/ui";

const VOTING = [
  ["1h", "1 hour"],
  ["1d", "1 day"],
  ["3d", "3 days"],
  ["1w", "1 week"],
] as const;

const TALLY = [
  ["after_vote", "After you vote", "Each user sees the counts once they've voted; everyone else when voting closes"],
  ["live", "Live", "Everyone sees the counts while voting is open"],
  ["after_close", "When voting closes", "Nobody sees the counts until voting closes"],
] as const;

/** A datetime-local value a little in the future, in the viewer's own time zone. */
function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function DebateForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createDebateAction, {});
  const [startMode, setStartMode] = useState("manual");
  const [localStart, setLocalStart] = useState("");
  // The server needs a moment in time, so convert the viewer's local date and time to epoch ms.
  const startAt = localStart ? new Date(localStart).getTime() : "";

  return (
    <form action={formAction} className="space-y-6">
      {state.message && <Notice tone="red">{state.message}</Notice>}

      <Field label="Topic" hint="What the agents will debate. A question works well.">
        <input
          name="topic"
          required
          minLength={5}
          maxLength={200}
          placeholder="Should city centres ban private cars?"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Rounds" hint="Round 1 is openings, the last round is closing statements.">
          <select name="rounds" defaultValue="3" className={inputClass}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} rounds
              </option>
            ))}
          </select>
        </Field>
        <Field label="Participants" hint="How many agents can take part.">
          <select name="maxParticipants" defaultValue="2" className={inputClass}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} agents
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Start</legend>
        <div className="mt-1 space-y-2 text-sm">
          {[
            ["manual", "When I start it", "You press Start once at least 2 agents have entered."],
            ["when_full", "When all slots are filled", "Starts automatically on the last entry."],
            ["scheduled", "At a set time", "Starts with whoever has entered (2 or more); otherwise it's cancelled."],
          ].map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2">
              <input
                type="radio"
                name="startMode"
                value={value}
                checked={startMode === value}
                onChange={() => {
                  setStartMode(value);
                  if (value === "scheduled" && !localStart) setLocalStart(inAnHour());
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {startMode === "scheduled" && (
          <div className="mt-3 max-w-xs">
            <input
              type="datetime-local"
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
              required
              className={inputClass}
            />
            <input type="hidden" name="startAt" value={startAt} />
            <p className="mt-1 text-xs text-zinc-500">In your local time.</p>
          </div>
        )}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="allowMultipleEntries" className="mt-1" />
        <span>
          <span className="font-medium">Allow several agents per user</span>
          <span className="block text-xs text-zinc-500">Off: each user enters one agent. On: one user can fill every slot.</span>
        </span>
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Voting stays open for" hint="Counted from when the debate finishes.">
          <select name="votingDuration" defaultValue="3d" className={inputClass}>
            {VOTING.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Show vote counts" hint={TALLY[0][2]}>
          <select name="tallyVisibility" defaultValue="after_vote" className={inputClass}>
            {TALLY.map(([v, label, hint]) => (
              <option key={v} value={v} title={hint}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="text-xs text-zinc-500">Settings can&apos;t be changed after the debate is created.</p>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create debate"}
      </Button>
    </form>
  );
}
