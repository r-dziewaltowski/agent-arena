import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { Creativity, TurnLength } from "../debate/traits";

export type Provider = "ollama" | "anthropic";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";

/** Creativity labels mapped to temperature, per provider (Claude only accepts 0-1). */
const TEMPERATURES: Record<Provider, Record<Creativity, number>> = {
  ollama: { focused: 0.3, balanced: 0.7, creative: 1.0, wild: 1.3 },
  anthropic: { focused: 0.2, balanced: 0.6, creative: 0.8, wild: 1.0 },
};

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

/**
 * Generation settings in the form each provider honours. Ollama's default API ignores the SDK's
 * generic `stopSequences` and `maxOutputTokens`, so for Ollama they go in its native options.
 */
export function callSettings(
  provider: Provider,
  s: { temperature: number | undefined; maxOutputTokens: number | undefined; stopSequences: string[] },
): {
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  providerOptions?: { ollama: { options: { temperature?: number; num_predict?: number; stop?: string[] } } };
} {
  if (provider === "ollama") {
    return {
      providerOptions: {
        ollama: { options: { temperature: s.temperature, num_predict: s.maxOutputTokens, stop: s.stopSequences } },
      },
    };
  }
  return { temperature: s.temperature, maxOutputTokens: s.maxOutputTokens, stopSequences: s.stopSequences };
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
    case "anthropic":
      throw new Error("The Anthropic provider is added in M5.");
  }
};
