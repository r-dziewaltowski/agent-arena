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
  /** Google's equivalent: how much a Gemini model thinks first (Gemma doesn't). */
  thinkingLevel?: "minimal" | "low";
  /** OpenRouter's equivalent, passed through to the model's company; reasoning text is never kept. */
  openRouterReasoning?: "none" | "minimal" | "low";
  /** List price in USD per million tokens (paid models), from OpenRouter's model list. */
  price?: { input: number; output: number };
  /** False for models that reject a temperature (current Claude): Creativity goes in the prompt. */
  supportsTemperature?: boolean;
  /** False for models that reject stop sequences; the prompt rule and name stripping cover it. */
  supportsStop?: boolean;
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
  // Google's free Gemma 4 models were left out (2026-11-16): most requests failed with "Internal
  // error" or "high demand", and the rest took about a minute. Retest before adding them:
  // `npm run models:google -- gemma-4-31b-it 10`. Give Gemma `thinkingLevel: "minimal"` (the only
  // level it accepts): otherwise it thinks ~300 tokens, more than a medium turn's cap.
  {
    provider: "google",
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    description: "Google's Gemini, in its free size. Concise; slower than Groq.",
    tier: "free",
    thinkingLevel: "minimal",
    offered: true,
    isDefault: true,
  },
  // Free models on the agent owner's own OpenRouter account: its free daily requests, no credit
  // needed. Picked 2026-11-16 by measuring (npm run models:openrouter): both answered every request
  // with reasoning "none"; at "minimal" Super spent the whole cap thinking. Gemma 4, ERNIE 5.5 and
  // Ling 3.2 were refused for lack of free capacity. OpenRouter's free list changes often: retest.
  {
    provider: "openrouter",
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "Nemotron 3 Ultra",
    description: "NVIDIA's largest open model. Confident, well-built arguments.",
    tier: "free",
    supportsStop: false,
    openRouterReasoning: "none",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "nvidia/nemotron-3.5-super-vl:free",
    name: "Nemotron 3.5 Super",
    description: "NVIDIA's mid-size model. Quick and direct.",
    tier: "free",
    supportsStop: false,
    openRouterReasoning: "none",
    offered: true,
  },
  // Paid models, on the agent owner's own OpenRouter account (M5). Prices: OpenRouter, 2026-11-16.
  {
    provider: "openrouter",
    id: "anthropic/claude-haiku-5.5",
    name: "Claude Haiku 5.5",
    description: "Anthropic's quick Claude. Sharp and cheap.",
    tier: "paid",
    price: { input: 0.1, output: 0.5 },
    supportsTemperature: false,
    openRouterReasoning: "low",
    offered: true,
    isDefault: true,
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    description: "Anthropic's all-rounder. Nuanced, persuasive arguments.",
    tier: "paid",
    price: { input: 2, output: 10 },
    supportsTemperature: false,
    openRouterReasoning: "low",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    description: "Anthropic's most capable Claude for debates. The priciest here.",
    tier: "paid",
    price: { input: 4, output: 20 },
    supportsTemperature: false,
    openRouterReasoning: "low",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "openai/gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "OpenAI's light GPT. Fast and inexpensive.",
    tier: "paid",
    price: { input: 0.2, output: 1.2 },
    supportsTemperature: false,
    supportsStop: false,
    openRouterReasoning: "minimal",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "google/gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Google's full-size Flash. Quick and well-informed.",
    tier: "paid",
    price: { input: 0.83, output: 4.13 },
    openRouterReasoning: "minimal",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    description: "DeepSeek's fast model. Very cheap.",
    tier: "paid",
    price: { input: 0.14, output: 0.42 },
    openRouterReasoning: "none",
    offered: true,
  },
  {
    provider: "openrouter",
    id: "mistralai/mistral-large-4-0",
    name: "Mistral Large 4",
    description: "Mistral's flagship, from Europe. Measured and precise.",
    tier: "paid",
    price: { input: 0.7, output: 2.1 },
    openRouterReasoning: "none",
    offered: true,
  },
];

export const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Ollama (local)",
  groq: "Free from Agent Arena: Groq (shared daily limit)",
  google: "Free from Agent Arena: Google (shared daily limit)",
  openrouter: "Paid, on your OpenRouter account",
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
