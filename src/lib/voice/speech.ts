/**
 * Turning a finished turn into speech with Gemini's text-to-speech (the app's free Google key; the
 * project never pays). The audio is compressed to MP3 for listeners and comes with marks that keep
 * the text in step with it (see `marks.ts`).
 *
 * Gemini's free voice models allow only a few requests each (gemini-3.8-flash-tts: 10 a day and 3
 * a minute, measured 2026-11-17), so a debate rotates through them: it keeps one model for as long
 * as it can, so its voices sound the same throughout, and moves to the next only when that model's
 * daily limit is used up. With all of them used up, turns go ahead as text only.
 */
import { buildMarks, type Mark } from "./marks";
import type { Voice } from "./voices";

/** Loaded lazily: fake-speech imports this module. */
const fakeSpeech: SpeechMaker = async (request) => (await import("./fake-speech")).fakeSpeechMaker(request);

export type SpeechRequest = {
  text: string;
  voice: Voice;
  /** How the agent speaks, in the owner's words (or derived from its tone). */
  direction: string;
  /** The voice model the debate has been using; null for its first spoken turn. */
  model?: string | null;
};

export type Speech = {
  audio: Uint8Array;
  mimeType: "audio/mpeg";
  durationMs: number;
  marks: Mark[];
  /** The voice model that made it. */
  model: string;
  /** The model the debate should use from now on (another one once this one's day is used up). */
  nextModel: string;
};

export type SpeechMaker = (request: SpeechRequest) => Promise<Speech>;

const API = "https://generativelanguage.googleapis.com/v1beta";
/** Gemini's voice models with a free tier, best first. The same 30 voices exist in each. */
export const VOICE_MODELS = ["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-3.8-flash-lite-tts"];
/** A per-minute limit asking to wait no longer than this is waited out, once. */
const MAX_MINUTE_WAIT_MS = 20_000;
/** A turn's speech normally takes 10-20 s to make; past this, the turn goes ahead as text only. */
const TIMEOUT_MS = 60_000;
const MP3_KBPS = 48;

/**
 * The speech maker debates use, or null when voices are off: no Google key, or `DEBATE_VOICE=0`
 * (unit tests). `GEMINI_TTS_MODELS` (comma-separated) replaces the list of models to rotate through.
 */
export function defaultSpeechMaker(env: Record<string, string | undefined> = process.env): SpeechMaker | null {
  if (env.DEBATE_VOICE === "0") return null;
  // End-to-end tests: a synthetic voice (fake-speech.ts), never on Vercel.
  if (env.E2E_FAKE_MODEL === "1" && !env.VERCEL) return fakeSpeech;
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  const listed = env.GEMINI_TTS_MODELS?.split(",").map((m) => m.trim()).filter(Boolean);
  const models = listed?.length ? listed : VOICE_MODELS;
  return (request) => speakWithRotation(request, { models, make: (r, model) => makeSpeech(r, { apiKey, model }) });
}

/** Gemini refused because a free-tier limit was reached. */
export class SpeechQuotaError extends Error {
  constructor(
    message: string,
    /** The model's requests for the day are used up (otherwise: for the minute). */
    readonly daily: boolean,
    readonly retryAfterMs: number | undefined,
  ) {
    super(message);
    this.name = "SpeechQuotaError";
  }
}

type MadeSpeech = Omit<Speech, "model" | "nextModel">;

/** Models whose day is used up, until when (per server instance: saves pointless requests). */
const usedUp = new Map<string, number>();

/**
 * Makes speech with the debate's model, moving down `models` when a model's daily limit is used
 * up (the debate keeps the new one: `nextModel`). A per-minute limit is waited out once if short;
 * otherwise, or after any other failure, the next model stands in for this turn only.
 */
export async function speakWithRotation(
  request: SpeechRequest,
  opts: {
    models: string[];
    make: (request: SpeechRequest, model: string) => Promise<MadeSpeech>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<Speech> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const first = Math.max(0, opts.models.indexOf(request.model ?? ""));
  let keep = opts.models[first];
  let lastError: unknown = new Error("No voice model to use.");
  for (let i = first; i < opts.models.length; i++) {
    const model = opts.models[i];
    const next = opts.models[i + 1];
    if ((usedUp.get(model) ?? 0) > now()) {
      if (keep === model && next) keep = next;
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const speech = await opts.make(request, model);
        return { ...speech, model, nextModel: keep };
      } catch (err) {
        lastError = err;
        if (!(err instanceof SpeechQuotaError)) break;
        if (err.daily) {
          usedUp.set(model, now() + (err.retryAfterMs ?? 60 * 60_000));
          if (keep === model && next) keep = next;
          break;
        }
        const wait = err.retryAfterMs ?? Infinity;
        if (attempt > 0 || wait > MAX_MINUTE_WAIT_MS) break;
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

/** Forgets which models were used up (tests). */
export function resetVoiceModelLimits(): void {
  usedUp.clear();
}

/**
 * The words Gemini gets, in the layout Google documents for its voice models: director's notes,
 * then the transcript. A plain "read the transcript below" preamble was read aloud in 2 of 3 tests
 * (2026-11-17); this layout in none of 4. The voice models don't accept a system instruction.
 */
export function speechPrompt(text: string, direction: string): string {
  const style = direction.trim().replace(/[.\s]+$/, "") || "Natural, like a confident debater";
  return `### DIRECTOR'S NOTES\nStyle: ${style}.\n\n#### TRANSCRIPT\n${text}`;
}

export async function makeSpeech(request: SpeechRequest, opts: { apiKey: string; model: string }): Promise<MadeSpeech> {
  const res = await fetch(`${API}/models/${opts.model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": opts.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: speechPrompt(request.text, request.direction) }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voice } } },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  type Answer = {
    error?: { message?: string; details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[];
  };
  const json = (await res.json()) as Answer;
  if (res.status === 429) {
    // Which limit: Google names the quota (".._PerDay_.." or "..PerMinute..") and how long to wait.
    const details = json.error?.details ?? [];
    const quotas = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
    const delay = details.find((d) => d.retryDelay)?.retryDelay;
    const retryAfterMs = delay ? Math.ceil(parseFloat(delay) * 1000) : undefined;
    const daily = quotas.some((q) => /PerDay/i.test(q));
    throw new SpeechQuotaError(`${opts.model}: free ${daily ? "daily" : "per-minute"} limit reached`, daily, retryAfterMs);
  }
  if (!res.ok) throw new Error(`Gemini speech failed (${res.status}): ${json.error?.message ?? "no details"}`);
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline) throw new Error("Gemini sent no audio.");

  const { samples, sampleRate } = decodePcm(Buffer.from(inline.data, "base64"), inline.mimeType);
  return {
    audio: await encodeMp3(samples, sampleRate),
    mimeType: "audio/mpeg",
    durationMs: Math.round((samples.length / sampleRate) * 1000),
    marks: buildMarks(request.text, samples, sampleRate),
  };
}

/** Gemini sends 16-bit mono PCM, either bare (`audio/L16;rate=24000`) or as a WAV file. */
export function decodePcm(bytes: Buffer, mimeType: string): { samples: Int16Array; sampleRate: number } {
  let data = bytes;
  let sampleRate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    let pos = 12;
    data = Buffer.alloc(0);
    while (pos + 8 <= bytes.length) {
      const id = bytes.toString("ascii", pos, pos + 4);
      let size = bytes.readUInt32LE(pos + 4);
      if (id === "fmt ") {
        const channels = bytes.readUInt16LE(pos + 10);
        const bits = bytes.readUInt16LE(pos + 22);
        if (channels !== 1 || bits !== 16) throw new Error(`Unexpected audio: ${channels} channels, ${bits} bits.`);
        sampleRate = bytes.readUInt32LE(pos + 12);
      } else if (id === "data") {
        // Streamed WAVs may leave the size unset.
        if (size === 0 || size === 0xffffffff || pos + 8 + size > bytes.length) size = bytes.length - pos - 8;
        data = bytes.subarray(pos + 8, pos + 8 + size);
        break;
      }
      pos += 8 + size + (size % 2);
    }
  }
  const samples = new Int16Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { samples, sampleRate };
}

export async function encodeMp3(samples: Int16Array, sampleRate: number): Promise<Uint8Array> {
  // Imported as an ES module on purpose: the package's CommonJS build exports nothing.
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS);
  const parts: Uint8Array[] = [];
  const block = 1152;
  for (let i = 0; i < samples.length; i += block) {
    const chunk = encoder.encodeBuffer(samples.subarray(i, i + block));
    if (chunk.length) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
