"use client";

import { useActionState, useState } from "react";
import { saveAgent, type AgentFormState } from "@/actions/agents";
import { Button, Field, inputClass, Notice, cx } from "@/components/ui";
import type { ModelGroup } from "@/lib/ai/model-options";
import {
  CREATIVITY_LABELS,
  CREATIVITY_LEVELS,
  CUSTOM_TRAIT,
  CUSTOM_TRAIT_MAX_LENGTH,
  STANCE_PRESETS,
  STANCES,
  STYLE_DESCRIPTIONS,
  TONE_DESCRIPTIONS,
  TURN_LENGTH_LABELS,
  TURN_LENGTHS,
  traitLabel,
} from "@/lib/debate/traits";

export type AgentFormValues = {
  id?: string;
  name: string;
  persona: string;
  style: string;
  tone: string;
  stance: string;
  provider: string;
  modelId: string;
  creativity: string;
  turnLength: string;
  visibility: string;
};

export function AgentForm({
  initial,
  modelGroups,
  currentModelLabel,
}: {
  initial: AgentFormValues;
  modelGroups: ModelGroup[];
  /** Shown when the agent's saved model isn't among today's options (e.g. retired). */
  currentModelLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<AgentFormState, FormData>(saveAgent, {});
  const e = state.errors ?? {};
  const currentValue = `${initial.provider}::${initial.modelId}`;
  const currentOffered = modelGroups.some((g) => g.models.some((m) => `${m.provider}::${m.id}` === currentValue));
  // After a rejected save, show what was submitted rather than the original values.
  const sent = state.values ?? {};
  const val = (key: keyof AgentFormValues | "model", fallback: string) => sent[key] ?? fallback;

  return (
    // Remounted after a rejected save so every field (dropdowns included) starts from what was sent.
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.message && <Notice tone="red">{state.message}</Notice>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Name" error={e.name} hint="How the agent is shown in debates. Each of your agents needs its own name.">
          <input name="name" defaultValue={val("name", initial.name)} maxLength={40} required className={inputClass} />
        </Field>
        <Field
          label="Model"
          error={e.model ?? e.provider ?? e.modelId}
          hint={modelGroups.length === 0 ? "No models available: set GROQ_API_KEY or start Ollama." : undefined}
        >
          <select name="model" defaultValue={val("model", currentValue)} required className={inputClass}>
            {!currentOffered && initial.modelId && (
              <option value={currentValue}>{currentModelLabel ?? initial.modelId} (no longer offered)</option>
            )}
            {modelGroups.map((g) => (
              <optgroup key={g.provider} label={g.label}>
                {g.models.map((m) => (
                  <option key={m.id} value={`${m.provider}::${m.id}`}>
                    {m.name}: {m.description}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Persona"
        error={e.persona}
        hint="Who the agent is: background, beliefs, expertise, quirks. This carries most of its identity. 10 to 1,500 characters."
      >
        <textarea
          name="persona"
          defaultValue={val("persona", initial.persona)}
          rows={5}
          minLength={10}
          maxLength={1500}
          required
          className={inputClass}
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-3">
        <TraitPicker
          name="style"
          label="Style"
          descriptions={STYLE_DESCRIPTIONS}
          customHint="How it argues, in a few words."
          customPlaceholder="e.g. asks pointed questions"
          stored={initial.style}
          sent={sent}
          error={e.style}
        />
        <TraitPicker
          name="tone"
          label="Tone"
          descriptions={TONE_DESCRIPTIONS}
          customHint="How it sounds, in a few words."
          customPlaceholder="e.g. cheerfully blunt"
          stored={initial.tone}
          sent={sent}
          error={e.tone}
        />
        <Field label="Stance" error={e.stance} hint="How it treats the other speakers.">
          <select name="stance" defaultValue={val("stance", initial.stance)} className={inputClass}>
            {STANCES.map((s) => (
              <option key={s} value={s} title={STANCE_PRESETS[s].description}>
                {traitLabel(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Segmented
        name="creativity"
        label="Creativity"
        options={CREATIVITY_LEVELS.map((v) => ({ value: v, ...CREATIVITY_LABELS[v] }))}
        defaultValue={val("creativity", initial.creativity)}
      />
      <Segmented
        name="turnLength"
        label="Turn length"
        options={TURN_LENGTHS.map((v) => ({ value: v, ...TURN_LENGTH_LABELS[v] }))}
        defaultValue={val("turnLength", initial.turnLength)}
      />
      <Segmented
        name="visibility"
        label="Visibility"
        options={[
          { value: "private", label: "Private", hint: "Others see only its name and arguments in debates" },
          { value: "public", label: "Public", hint: "Others can view its full persona and settings" },
        ]}
        defaultValue={val("visibility", initial.visibility)}
      />
      <p className="-mt-3 text-xs text-zinc-500">Either way, only you can enter this agent into debates.</p>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending || modelGroups.length === 0}>
          {pending ? "Saving…" : initial.id ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Style or tone: a dropdown of presets (shown by name, with a one-line description underneath)
 * plus "Write your own…", which reveals a short text box. The form sends `<name>Choice` and
 * `<name>Custom`; the server turns them into the stored value (a preset key or the custom text).
 */
function TraitPicker({
  name,
  label,
  descriptions,
  customHint,
  customPlaceholder,
  stored,
  sent,
  error,
}: {
  name: "style" | "tone";
  label: string;
  descriptions: Record<string, string>;
  customHint: string;
  customPlaceholder: string;
  /** The agent's saved value: a preset key or custom text. */
  stored: string;
  /** What was submitted, after a rejected save. */
  sent: Record<string, string>;
  error?: string[];
}) {
  const isPreset = (v: string) => Object.hasOwn(descriptions, v);
  const initialChoice = sent[`${name}Choice`] ?? (isPreset(stored) ? stored : stored ? CUSTOM_TRAIT : Object.keys(descriptions)[0]);
  const initialCustom = sent[`${name}Custom`] ?? (isPreset(stored) ? "" : stored);
  const [choice, setChoice] = useState(initialChoice);
  const custom = choice === CUSTOM_TRAIT;

  return (
    <Field label={label} error={error} hint={custom ? customHint : descriptions[choice]}>
      <select
        name={`${name}Choice`}
        defaultValue={initialChoice}
        onChange={(event) => setChoice(event.target.value)}
        className={inputClass}
      >
        {Object.keys(descriptions).map((key) => (
          <option key={key} value={key}>
            {traitLabel(key)}
          </option>
        ))}
        <option value={CUSTOM_TRAIT}>Write your own…</option>
      </select>
      {custom && (
        <input
          name={`${name}Custom`}
          defaultValue={initialCustom}
          maxLength={CUSTOM_TRAIT_MAX_LENGTH}
          required
          placeholder={customPlaceholder}
          aria-label={`Your own ${label.toLowerCase()}`}
          className={cx(inputClass, "mt-2")}
          autoFocus={!sent[`${name}Choice`] && !initialCustom}
        />
      )}
    </Field>
  );
}

function Segmented({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: { value: string; label: string; hint: string }[];
  defaultValue: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className={cx("mt-1 grid gap-2", options.length === 4 ? "sm:grid-cols-4" : options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm has-checked:border-indigo-500 has-checked:bg-indigo-50 has-checked:ring-1 has-checked:ring-indigo-500 dark:border-zinc-700 dark:has-checked:bg-indigo-950"
          >
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} className="sr-only" />
            <span className="block font-medium">{o.label}</span>
            <span className="block text-xs text-zinc-500">{o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
