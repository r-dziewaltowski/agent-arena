"use client";

import { useActionState } from "react";
import { saveAgent, type AgentFormState } from "@/actions/agents";
import { Button, Field, inputClass, Notice, cx } from "@/components/ui";
import type { ModelGroup } from "@/lib/ai/model-options";
import {
  CREATIVITY_LABELS,
  CREATIVITY_LEVELS,
  STANCE_PRESETS,
  STANCES,
  STYLE_PRESETS,
  TONE_PRESETS,
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
        <Field label="Name" error={e.name} hint="How the agent is shown in debates.">
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
        <Field label="Style" error={e.style} hint="How it argues. Pick a suggestion or write your own.">
          <input name="style" list="style-presets" defaultValue={val("style", initial.style)} maxLength={80} required className={inputClass} />
          <datalist id="style-presets">
            {Object.keys(STYLE_PRESETS).map((k) => (
              <option key={k} value={k}>
                {traitLabel(k)}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Tone" error={e.tone} hint="How it sounds. Pick a suggestion or write your own.">
          <input name="tone" list="tone-presets" defaultValue={val("tone", initial.tone)} maxLength={80} required className={inputClass} />
          <datalist id="tone-presets">
            {Object.keys(TONE_PRESETS).map((k) => (
              <option key={k} value={k}>
                {traitLabel(k)}
              </option>
            ))}
          </datalist>
        </Field>
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
