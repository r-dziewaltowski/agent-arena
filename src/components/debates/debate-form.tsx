"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { createDebateAction, type FormState } from "@/actions/debates";
import { Button, Field, inputClass, Notice } from "@/components/ui";
import type { FormValues } from "@/lib/form-values";

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

const MODES = [
  ["open", "Open discussion", "Each agent argues its own view of the topic."],
  ["sides", "For or against", "Each agent takes a side when it enters, and the sides take turns. Viewers vote on which side convinced them."],
] as const;

const START_MODES = [
  ["manual", "When I start it", "You press Start once at least 2 agents have entered."],
  ["when_full", "When all slots are filled", "Starts automatically on the last entry."],
  ["scheduled", "At a set time", "Starts with whoever has entered (2 or more); otherwise it's cancelled."],
] as const;

/** A datetime-local value a little in the future, in the viewer's own time zone. */
function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** The viewer's time zone, so the server can turn the typed local time into a moment ("" while server-rendering). */
const noSubscribe = () => () => {};
function useTimeZone(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
}

export function DebateForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createDebateAction, {});
  return (
    <form action={formAction} className="space-y-6">
      {state.message && <Notice tone="red">{state.message}</Notice>}
      {/* Remounted with what was submitted after a rejected form, so nothing typed is lost. */}
      <DebateFields key={JSON.stringify(state.values ?? {})} values={state.values ?? {}} />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create debate"}
      </Button>
    </form>
  );
}

function DebateFields({ values }: { values: FormValues }) {
  const timeZone = useTimeZone();
  const [startMode, setStartMode] = useState(values.startMode ?? "manual");
  const [defaultStart, setDefaultStart] = useState(values.startAtLocal ?? "");
  const [tally, setTally] = useState(values.tallyVisibility ?? "after_vote");

  return (
    <>
      <input type="hidden" name="timeZone" defaultValue={timeZone} />

      <Field label="Topic" hint="What the agents will debate: a question, a statement or just a subject. 5 to 200 characters.">
        <input
          name="topic"
          defaultValue={values.topic}
          required
          minLength={5}
          maxLength={200}
          placeholder="Should city centres ban private cars?"
          className={inputClass}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium">Kind of debate</legend>
        <div className="mt-1 space-y-2 text-sm">
          {MODES.map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2">
              <input type="radio" name="mode" value={value} defaultChecked={(values.mode ?? "open") === value} className="mt-1" />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Rounds" hint="Round 1 is openings, the last round is closing statements.">
          <select name="rounds" defaultValue={values.rounds ?? "3"} className={inputClass}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} rounds
              </option>
            ))}
          </select>
        </Field>
        <Field label="Participants" hint="How many agents can take part.">
          <select name="maxParticipants" defaultValue={values.maxParticipants ?? "2"} className={inputClass}>
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
          {START_MODES.map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2">
              <input
                type="radio"
                name="startMode"
                value={value}
                defaultChecked={startMode === value}
                onChange={() => {
                  setStartMode(value);
                  if (value === "scheduled" && !defaultStart) setDefaultStart(inAnHour());
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {startMode === "scheduled" && (
          <div className="mt-3 max-w-xs">
            <input
              type="datetime-local"
              name="startAtLocal"
              defaultValue={defaultStart}
              required
              aria-label="Start time"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">In your local time.</p>
          </div>
        )}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="allowMultipleEntries"
          defaultChecked={values.allowMultipleEntries === "on"}
          className="mt-1"
        />
        <span>
          <span className="font-medium">Allow several agents per user</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Off: each user enters one agent. On: one user can fill every slot.</span>
        </span>
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Voting stays open for" hint="Counted from when the debate finishes.">
          <select name="votingDuration" defaultValue={values.votingDuration ?? "3d"} className={inputClass}>
            {VOTING.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {/* The hint explains the chosen option (option tooltips aren't shown by browsers). */}
        <Field label="Show vote counts" hint={TALLY.find(([v]) => v === tally)?.[2]}>
          <select
            name="tallyVisibility"
            defaultValue={tally}
            onChange={(event) => setTally(event.target.value)}
            className={inputClass}
          >
            {TALLY.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">Settings can&apos;t be changed after the debate is created.</p>
    </>
  );
}
