import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { Creativity, TurnLength } from "../debate/traits";

export type Provider = "ollama" | "groq" | "anthropic";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
/** Groq's free tier, on an account with no payment method, so it can never be billed. */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Groq's current chat models reason before answering, and reasoning tokens count against the
 * turn's token cap. Keep reasoning minimal and hidden so the cap goes to the actual turn.
 * gpt-oss can't switch reasoning off (lowest is "low"); Qwen can ("none").
 */
export function groqReasoningOptions(
  modelId: string,
): { reasoningEffort: "none" | "low"; reasoningFormat: "hidden" } | undefined {
  if (modelId.includes("gpt-oss")) return { reasoningEffort: "low", reasoningFormat: "hidden" };
  if (/qwen3/i.test(modelId)) return { reasoningEffort: "none", reasoningFormat: "hidden" };
  return undefined;
}

/** Creativity labels mapped to temperature, per provider (Claude only accepts 0-1). */
const TEMPERATURES: Record<Provider, Record<Creativity, number>> = {
  ollama: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  groq: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  anthropic: { focused: 0.2, balanced: 0.6, creative: 0.8, wild: 1.0 },
};

/** The default model for a provider, overridable per environment. */
export function defaultModelFor(provider: Provider): string {
  switch (provider) {
    case "ollama":
      return process.env.OLLAMA_DEFAULT_MODEL ?? DEFAULT_OLLAMA_MODEL;
    case "groq":
      return process.env.GROQ_DEFAULT_MODEL ?? DEFAULT_GROQ_MODEL;
    case "anthropic":
      return "claude-haiku-5-5";
  }
}

const MAX_OUTPUT_TOKENS: Record<TurnLength, number> = { short: 120, medium: 220, long: 400 };

/** Turns an agent's labels into the numbers sent to the model, for its provider. */
export function resolveSettings(
  provider: Provider,
  creativity: Creativity,
  turnLength: TurnLength,
): { temperature: number; maxOutputTokens: number } {
  return {
    temperature: TEMPERATURES[provider][creativity],
    maxOutputTokens: MAX_OUTPUT_TOKENS[turnLength],
  };
}

type CallSettings = {
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  providerOptions?: {
    ollama?: { options: { temperature?: number; num_predict?: number; stop?: string[] } };
    groq?: { reasoningEffort: "none" | "low"; reasoningFormat: "hidden" };
  };
};

/**
 * Generation settings in the form each provider honours. Ollama's default API ignores the SDK's
 * generic `stopSequences` and `maxOutputTokens`, so for Ollama they go in its native options.
 * Groq's reasoning models get minimal, hidden reasoning.
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
  return generic;
}

export type ModelResolver = (provider: Provider, modelId: string) => LanguageModel;

/** The only place that knows which provider package to use. */
export const resolveModel: ModelResolver = (provider, modelId) => {
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
    case "anthropic":
      throw new Error("The Anthropic provider is added in M5.");
  }
};
