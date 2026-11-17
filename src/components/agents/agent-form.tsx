"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { saveAgent, type AgentFormState } from "@/actions/agents";
import { Button, Field, inputClass, Notice, cx } from "@/components/ui";
import type { ModelGroup } from "@/lib/ai/model-options";
import {
  CREATIVITY_LABELS,
  CREATIVITY_LEVELS,
  CUSTOM_TRAIT,
  CUSTOM_TRAIT_MAX_LENGTH,
  STANCE_DESCRIPTIONS,
  STANCES,
  STYLE_DESCRIPTIONS,
  TONE_DESCRIPTIONS,
  TURN_LENGTH_LABELS,
  TURN_LENGTHS,
  traitLabel,
} from "@/lib/debate/traits";
import { generatedAvatarUrl, MAX_ORIGINAL_BYTES, randomSeed, UPLOAD_SIZE_PX } from "@/lib/avatars";
import { isVoice, VOICE_NAMES, VOICE_STYLE_MAX_LENGTH, VOICES, voicePreviewUrl } from "@/lib/voice/voices";

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
  voice: string;
  voiceStyle: string;
  /** Seed of its generated face; empty: the agent's id. */
  avatarSeed: string;
  /** Its uploaded picture's address, if it has one. */
  pictureUrl: string | null;
};

export function AgentForm({
  initial,
  modelGroups,
  paidConnected = false,
  currentModelLabel,
}: {
  initial: AgentFormValues;
  modelGroups: ModelGroup[];
  /** Whether the user has connected OpenRouter; otherwise the form says how to get paid models. */
  paidConnected?: boolean;
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
  const modelDescriptions = new Map<string, string>(
    modelGroups.flatMap((g) => g.models.map((m) => [`${m.provider}::${m.id}`, m.description] as [string, string])),
  );

  return (
    // Remounted after a rejected save so every field (dropdowns included) starts from what was sent.
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.message && <Notice tone="red">{state.message}</Notice>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Name" error={e.name} hint="How the agent is shown in debates. Each of your agents needs its own name.">
          <input name="name" defaultValue={val("name", initial.name)} maxLength={40} required className={inputClass} />
        </Field>
        <SelectWithHint
          name="model"
          label="Model"
          error={e.model ?? e.provider ?? e.modelId}
          defaultValue={val("model", currentValue)}
          required
          hintFor={(v) =>
            modelGroups.length === 0
              ? "No models available: set GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, or start Ollama."
              : (modelDescriptions.get(v) ??
                "No longer offered. Pick a current model; until then, debates use the provider's default.")
          }
        >
          {!currentOffered && initial.modelId && (
            <option value={currentValue}>{currentModelLabel ?? initial.modelId} (no longer offered)</option>
          )}
          {modelGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.models.map((m) => (
                <option key={m.id} value={`${m.provider}::${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectWithHint>
      </div>
      {!paidConnected && (
        <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Want more models, including Claude and GPT? Connect your OpenRouter account on{" "}
          <Link href="/account" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            your account page
          </Link>
          : two more free models, and paid ones on your own credit.
        </p>
      )}

      <PicturePicker
        agentId={initial.id}
        initialSeed={val("avatarSeed", initial.avatarSeed)}
        initialPictureUrl={initial.pictureUrl}
        error={e.image}
      />

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
        <SelectWithHint
          name="stance"
          label="Stance"
          error={e.stance}
          defaultValue={val("stance", initial.stance)}
          hintFor={(v) => STANCE_DESCRIPTIONS[v as keyof typeof STANCE_DESCRIPTIONS] ?? "How it treats the other speakers."}
        >
          {STANCES.map((s) => (
            <option key={s} value={s}>
              {traitLabel(s)}
            </option>
          ))}
        </SelectWithHint>
      </div>

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <VoicePicker defaultValue={val("voice", initial.voice)} error={e.voice} />
        <VoiceStyleField defaultValue={val("voiceStyle", initial.voiceStyle)} error={e.voiceStyle} />
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
      <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">Either way, only you can enter this agent into debates.</p>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending || modelGroups.length === 0}>
          {pending ? "Saving…" : initial.id ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}

/**
 * A dropdown whose hint describes the chosen option. Browsers don't show tooltips on options, so
 * descriptions live under the field and follow the selection.
 */
function SelectWithHint({
  name,
  label,
  error,
  defaultValue,
  required,
  hintFor,
  children,
}: {
  name: string;
  label: string;
  error?: string[];
  defaultValue: string;
  required?: boolean;
  hintFor: (value: string) => string;
  children: ReactNode;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Field label={label} error={error} hint={hintFor(value)}>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        onChange={(event) => setValue(event.target.value)}
        className={inputClass}
      >
        {children}
      </select>
    </Field>
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

/**
 * The agent's picture: an uploaded one, or a generated face the owner can swap for another. The
 * browser crops an upload to a square and shrinks it before sending (which also drops hidden data,
 * such as where a photo was taken); the server checks it again.
 */
function PicturePicker({
  agentId,
  initialSeed,
  initialPictureUrl,
  error,
}: {
  agentId?: string;
  initialSeed: string;
  initialPictureUrl: string | null;
  error?: string[];
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [pictureUrl, setPictureUrl] = useState(initialPictureUrl);
  const [removed, setRemoved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const preview = pictureUrl ?? generatedAvatarUrl(seed || agentId || "new agent");

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_ORIGINAL_BYTES) return setProblem("That file is too large (15 MB at most).");
    setBusy(true);
    try {
      const small = await shrinkPicture(file);
      const files = new DataTransfer();
      files.items.add(small);
      if (uploadRef.current) uploadRef.current.files = files.files;
      setPictureUrl((old) => {
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
      setRemoved(false);
    } catch {
      setProblem("That file couldn't be read as a picture. Try a JPEG, PNG or WebP.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (uploadRef.current) uploadRef.current.value = "";
    setPictureUrl(null);
    setRemoved(true);
  };

  return (
    <fieldset>
      <legend className="text-sm font-medium">Picture</legend>
      <div className="mt-1 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: address) */}
        <img src={preview} alt="" width={80} height={80} className="size-20 shrink-0 rounded-full bg-zinc-100 object-cover dark:bg-zinc-800" />
        <div className="flex flex-wrap gap-2">
          <label
            className={cx(
              "cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-500 dark:border-zinc-700 dark:hover:bg-zinc-900",
              busy && "opacity-60",
            )}
          >
            {busy ? "Preparing…" : pictureUrl ? "Upload another" : "Upload a picture"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="sr-only"
              disabled={busy}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </label>
          {pictureUrl ? (
            <Button type="button" variant="secondary" onClick={remove}>
              Remove picture
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setSeed(randomSeed())}>
              Another face
            </Button>
          )}
        </div>
      </div>
      {/* What's sent: the shrunk picture, whether to remove the saved one, and the face's seed. */}
      <input ref={uploadRef} type="file" name="image" hidden tabIndex={-1} aria-hidden />
      <input type="hidden" name="removeImage" value={removed ? "1" : ""} />
      <input type="hidden" name="avatarSeed" value={seed} />
      {problem || error?.[0] ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{problem ?? error?.[0]}</p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Shown next to its name in debates, to everyone (also for private agents). Uploads are cropped to a square. Without
          one, it gets a drawn face.
        </p>
      )}
    </fieldset>
  );
}

/** Crops a picture to a centred square of at most 256 px and re-encodes it (WebP, or JPEG where unsupported). */
async function shrinkPicture(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(UPLOAD_SIZE_PX, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  let blob = await encode("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob) throw new Error("Couldn't encode the picture.");
  return new File([blob], blob.type === "image/webp" ? "picture.webp" : "picture.jpg", { type: blob.type });
}

/** The voice: one of Gemini's voices, with a button to hear it. */
function VoicePicker({ defaultValue, error }: { defaultValue: string; error?: string[] }) {
  const [voice, setVoice] = useState(isVoice(defaultValue) ? defaultValue : VOICE_NAMES[0]);
  const [playing, setPlaying] = useState(false);
  // Samples are made a few a day (the free limit), so some voices may not have one yet.
  const [missing, setMissing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(voicePreviewUrl(voice));
    audioRef.current?.pause();
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      setMissing(voice);
    };
    setPlaying(true);
    audio.play().catch(() => setPlaying(false));
  };

  return (
    <Field
      label="Voice"
      error={error}
      hint={missing === voice ? "There's no sample of this voice yet. It still works in debates." : "How it sounds when people listen to a live debate."}
    >
      <div className="flex gap-2">
        <select
          name="voice"
          defaultValue={voice}
          onChange={(event) => {
            audioRef.current?.pause();
            setPlaying(false);
            setVoice(event.target.value as typeof voice);
          }}
          className={inputClass}
        >
          {VOICE_NAMES.map((v) => (
            <option key={v} value={v}>
              {v} · {VOICES[v]}
            </option>
          ))}
        </select>
        <Button type="button" variant="secondary" onClick={toggle} aria-label={playing ? "Stop the voice sample" : `Hear ${voice}`} className="shrink-0">
          {playing ? "Stop" : "Play"}
        </Button>
      </div>
    </Field>
  );
}

const VOICE_STYLE_IDEAS = [
  "Fast-talking and excitable",
  "Calm, warm and unhurried",
  "A gravelly old sea captain",
  "A crisp radio newsreader",
];

/** How it speaks, in the owner's own words, with a few ideas to start from. */
function VoiceStyleField({ defaultValue, error }: { defaultValue: string; error?: string[] }) {
  const [text, setText] = useState(defaultValue);
  return (
    <Field
      label="How it speaks (optional)"
      error={error}
      hint="Character, mood, pace or accent, in your own words. Empty: it follows the tone. The text always keeps pace with the voice."
    >
      <input
        name="voiceStyle"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={VOICE_STYLE_MAX_LENGTH}
        placeholder="e.g. a weary professor, dry and slightly sarcastic"
        className={inputClass}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {VOICE_STYLE_IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => setText(idea)}
            className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            {idea}
          </button>
        ))}
      </div>
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
            className="cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm has-checked:border-indigo-500 has-checked:bg-indigo-50 has-checked:ring-1 has-checked:ring-indigo-500 dark:border-zinc-700 dark:has-checked:bg-indigo-950 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-500"
          >
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} className="sr-only" />
            <span className="block font-medium">{o.label}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
