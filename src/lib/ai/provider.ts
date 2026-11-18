import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { Creativity, TurnLength } from "../debate/traits";
import { fakeModel, fakeModelsEnabled } from "./fake-model";
import { findModel } from "./models";

export type Provider = "ollama" | "groq" | "google" | "openrouter" | "anthropic";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
/** Groq's free tier, on an account with no payment method, so it can never be billed. */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
/** Google's free tier (Gemini API key from AI Studio, billing never enabled), likewise never billed. */
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
/** Paid models run on the agent owner's own OpenRouter account (M5); this is the cheap default. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";

/** Google's key, under the name its SDK reads by default. */
export function googleApiKey(): string | undefined {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || undefined;
}

/**
 * Gemini models think before answering, and thinking tokens count against the turn's cap: keep
 * it minimal. Settings come from the model catalog; unknown Gemini ids get the minimal level.
 */
export function googleThinkingOptions(modelId: string): { thinkingConfig: { thinkingLevel: "minimal" | "low" } } | undefined {
  const entry = findModel("google", modelId);
  const level = entry ? entry.thinkingLevel : modelId.startsWith("gemini-") ? "minimal" : undefined;
  return level ? { thinkingConfig: { thinkingLevel: level } } : undefined;
}

/**
 * Groq's current chat models reason before answering, and reasoning tokens count against the
 * turn's token cap. Keep reasoning minimal and hidden so the cap goes to the actual turn.
 * Settings come from the model catalog; for ids not in it, guess from the name
 * (gpt-oss can't switch reasoning off, lowest is "low"; Qwen can, "none").
 */
export function groqReasoningOptions(
  modelId: string,
): { reasoningEffort: "none" | "low"; reasoningFormat: "hidden" } | undefined {
  const entry = findModel("groq", modelId);
  if (entry) {
    return entry.reasoning ? { reasoningEffort: entry.reasoning.effort, reasoningFormat: entry.reasoning.format } : undefined;
  }
  if (modelId.includes("gpt-oss")) return { reasoningEffort: "low", reasoningFormat: "hidden" };
  if (/qwen3/i.test(modelId)) return { reasoningEffort: "none", reasoningFormat: "hidden" };
  return undefined;
}

/** Creativity labels mapped to temperature, per provider (Claude only accepts 0-1). */
const TEMPERATURES: Record<Provider, Record<Creativity, number>> = {
  ollama: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  groq: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  google: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  openrouter: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  anthropic: { focused: 0.2, balanced: 0.6, creative: 0.8, wild: 1.0 },
};

/**
 * A free model for work that serves the whole debate (the rolling summary), so it never runs on
 * one owner's paid key: Groq's default when configured, else Google's; null when neither is.
 */
export function freeSummaryModel(): { provider: Provider; modelId: string } | null {
  if (process.env.GROQ_API_KEY) return { provider: "groq", modelId: defaultModelFor("groq") };
  if (googleApiKey()) return { provider: "google", modelId: defaultModelFor("google") };
  return null;
}

/** The default model for a provider, overridable per environment. */
export function defaultModelFor(provider: Provider): string {
  switch (provider) {
    case "ollama":
      return process.env.OLLAMA_DEFAULT_MODEL ?? DEFAULT_OLLAMA_MODEL;
    case "groq":
      return process.env.GROQ_DEFAULT_MODEL ?? DEFAULT_GROQ_MODEL;
    case "google":
      return process.env.GOOGLE_DEFAULT_MODEL ?? DEFAULT_GOOGLE_MODEL;
    case "openrouter":
      return DEFAULT_OPENROUTER_MODEL;
    case "anthropic":
      return "claude-haiku-5-5";
  }
}

/** Tokens for the turn people read, by turn length; the prompt asks for a word count that fits. */
export const ANSWER_TOKENS: Record<TurnLength, number> = { short: 120, medium: 220, long: 400 };

/**
 * Extra cap for models that think before answering: their hidden thinking counts toward the cap.
 * Measured on production (2026-11-18): GPT-OSS 120B spent ~30-40 of a short turn's 120 tokens
 * thinking, and 1 turn in 9 was cut to 43 words. The word target stays the same, so turns don't
 * get longer; they just don't get cut short.
 */
export const THINKING_ROOM_TOKENS = 100;

/**
 * Whether a model is set to think before answering. Google's models are left out: Flash-Lite at
 * "minimal" stayed well under the cap (short turns: 85 tokens at most).
 */
export function thinksFirst(provider: Provider, modelId?: string): boolean {
  const entry = modelId === undefined ? undefined : findModel(provider, modelId);
  if (!entry) return false;
  return (entry.reasoning !== undefined && entry.reasoning.effort !== "none") || (entry.openRouterReasoning !== undefined && entry.openRouterReasoning !== "none");
}

/**
 * Turns an agent's labels into the numbers sent to the model, for its provider. Models that reject
 * a temperature get none (null): their Creativity is described in the prompt instead. Models that
 * think first get extra room in their cap for it.
 */
export function resolveSettings(
  provider: Provider,
  creativity: Creativity,
  turnLength: TurnLength,
  modelId?: string,
): { temperature: number | null; maxOutputTokens: number } {
  const takesTemperature = modelId === undefined || findModel(provider, modelId)?.supportsTemperature !== false;
  return {
    temperature: takesTemperature ? TEMPERATURES[provider][creativity] : null,
    maxOutputTokens: ANSWER_TOKENS[turnLength] + (thinksFirst(provider, modelId) ? THINKING_ROOM_TOKENS : 0),
  };
}

type CallSettings = {
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  providerOptions?: {
    ollama?: { options: { temperature?: number; num_predict?: number; stop?: string[] } };
    groq?: { reasoningEffort: "none" | "low"; reasoningFormat: "hidden" };
    google?: { thinkingConfig: { thinkingLevel: "minimal" | "low" } };
    openrouter?: { reasoning: { effort: "none" | "minimal" | "low"; exclude: true } };
  };
};

/**
 * Generation settings in the form each provider honours. Ollama's default API ignores the SDK's
 * generic `stopSequences` and `maxOutputTokens`, so for Ollama they go in its native options.
 * Groq's reasoning models get minimal, hidden reasoning; Gemini models minimal thinking. OpenRouter
 * models get their catalog reasoning level, and no temperature or stop sequences where they reject them.
 */
export function callSettings(
  provider: Provider,
  modelId: string,
  s: { temperature: number | undefined; maxOutputTokens: number | undefined; stopSequences: string[] },
): CallSettings {
  if (provider === "ollama") {
    return {
      providerOptions: {
        ollama: { options: { temperature: s.temperature, num_predict: s.maxOutputTokens, stop: s.stopSequences } },
      },
    };
  }
  const generic = { temperature: s.temperature, maxOutputTokens: s.maxOutputTokens, stopSequences: s.stopSequences };
  if (provider === "groq") {
    const reasoning = groqReasoningOptions(modelId);
    return reasoning ? { ...generic, providerOptions: { groq: reasoning } } : generic;
  }
  if (provider === "google") {
    const thinking = googleThinkingOptions(modelId);
    return thinking ? { ...generic, providerOptions: { google: thinking } } : generic;
  }
  if (provider === "openrouter") {
    const entry = findModel("openrouter", modelId);
    return {
      maxOutputTokens: s.maxOutputTokens,
      ...(entry?.supportsTemperature === false ? {} : { temperature: s.temperature }),
      ...(entry?.supportsStop === false ? {} : { stopSequences: s.stopSequences }),
      ...(entry?.openRouterReasoning
        ? { providerOptions: { openrouter: { reasoning: { effort: entry.openRouterReasoning, exclude: true as const } } } }
        : {}),
    };
  }
  return generic;
}

/** `apiKey`: the agent owner's own key, for paid providers (OpenRouter). */
export type ModelResolver = (provider: Provider, modelId: string, opts?: { apiKey?: string }) => LanguageModel;

/** The only place that knows which provider package to use. */
export const resolveModel: ModelResolver = (provider, modelId, opts) => {
  if (fakeModelsEnabled()) return fakeModel(); // end-to-end tests only
  switch (provider) {
    case "ollama": {
      const ollama = createOllama({
        baseURL: process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
      });
      return ollama(modelId);
    }
    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY is not set, so Groq models can't be used.");
      return createGroq({ apiKey })(modelId);
    }
    case "google": {
      const apiKey = googleApiKey();
      if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set, so Google models can't be used.");
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case "openrouter": {
      if (!opts?.apiKey) throw new Error("No OpenRouter key: paid models run on the agent owner's own account.");
      return createOpenRouter({ apiKey: opts.apiKey, headers: { "X-Title": "Agent Arena" } })(modelId);
    }
    case "anthropic":
      throw new Error("Direct Anthropic keys aren't supported; Claude runs through OpenRouter.");
  }
};
