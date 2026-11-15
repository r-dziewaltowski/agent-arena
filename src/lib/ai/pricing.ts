import { findModel } from "./models";
import type { Provider } from "./provider";

/**
 * Cost per million tokens, in USD, for paid models (M5, billed to the agent owner's own key).
 * Free models (Ollama, Groq's free tier) cost nothing.
 */
const PAID_PRICES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function isFree(provider: string, modelId: string): boolean {
  if (provider === "ollama") return true;
  return findModel(provider as Provider, modelId)?.tier !== "paid" && !PAID_PRICES[`${provider}/${modelId}`];
}

export function costUsd(provider: string, modelId: string, promptTokens: number, completionTokens: number): number {
  const price = PAID_PRICES[`${provider}/${modelId}`];
  if (!price) return 0;
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}
