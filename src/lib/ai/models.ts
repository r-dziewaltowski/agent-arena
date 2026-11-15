import type { Provider } from "./provider";

/**
 * The models agents can pick. A list rather than free text because models get retired (Groq
 * retired its Llama models) and need per-model settings. Ollama is the exception: its models are
 * whatever is installed locally, read from Ollama itself (see `listOllamaModels`).
 */
export type ModelEntry = {
  provider: Provider;
  id: string;
  name: string;
  description: string;
  /** free = runs on the app's free tier; paid = runs on the agent owner's own key (M5). */
  tier: "free" | "paid";
  /** Reasoning models spend part of the token cap thinking; keep it minimal and hidden. */
  reasoning?: { effort: "none" | "low"; format: "hidden" };
  /** False once a model is retired: hidden from the picker, replaced at debate start. */
  offered: boolean;
  isDefault?: boolean;
};

export const MODEL_CATALOG: ModelEntry[] = [
  {
    provider: "groq",
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    description: "Strongest free model. Fast, sharp rebuttals.",
    tier: "free",
    reasoning: { effort: "low", format: "hidden" },
    offered: true,
    isDefault: true,
  },
  {
    provider: "groq",
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    description: "Smaller and quicker; a little less nuanced.",
    tier: "free",
    reasoning: { effort: "low", format: "hidden" },
    offered: true,
  },
  {
    provider: "groq",
    id: "qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    description: "A different model family, for variety.",
    tier: "free",
    reasoning: { effort: "none", format: "hidden" },
    offered: true,
  },
  {
    provider: "groq",
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    description: "Retired by Groq.",
    tier: "free",
    offered: false,
  },
];

export const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Ollama (local)",
  groq: "Groq (free tier)",
  anthropic: "Anthropic (your key)",
};

export function findModel(provider: Provider, id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.id === id);
}

/** Offered catalog models for a provider, default first. */
export function offeredModels(provider: Provider): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider && m.offered).sort(
    (a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)),
  );
}

/**
 * Answers "can this model still be used?" when a debate starts. Only models known to be gone
 * count as unavailable: a catalog entry marked not offered, or an Ollama model that isn't
 * installed. Unknown ids (e.g. passed to the terminal CLI) are allowed, and when Ollama can't be
 * reached its models count as available, so the engine's wait-and-retry handles the outage.
 */
export type ModelAvailability = { isAvailable(provider: Provider, modelId: string): boolean };

export function catalogAvailability(installedOllamaModels?: string[] | null): ModelAvailability {
  const installed = installedOllamaModels ? new Set(installedOllamaModels.map(normalizeOllamaName)) : null;
  return {
    isAvailable(provider, modelId) {
      if (provider === "ollama") return installed === null || installed.has(normalizeOllamaName(modelId));
      const entry = findModel(provider, modelId);
      return entry ? entry.offered : true;
    },
  };
}

/** "llama3.2" and "llama3.2:latest" are the same Ollama model. */
export function normalizeOllamaName(name: string): string {
  return name.includes(":") ? name : `${name}:latest`;
}

/** Installed Ollama models, or null if Ollama can't be reached. */
export async function listOllamaModels(
  baseURL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/api",
  timeoutMs = 1500,
): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}
