import { findModel } from "./models";
import type { Provider } from "./provider";

/**
 * What paid models cost, from the catalog's list prices (USD per million tokens). Paid turns are
 * billed to the agent owner's own OpenRouter account; free models (Ollama, Groq's and Google's
 * free tiers) cost nothing.
 */
export type Price = { input: number; output: number };

export function priceOf(provider: string | null, modelId: string | null): Price | null {
  if (!provider || !modelId) return null;
  const entry = findModel(provider as Provider, modelId);
  return entry?.tier === "paid" && entry.price ? entry.price : null;
}

export function costUsd(price: Price, promptTokens: number, completionTokens: number): number {
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

/** A turn's rough cost, for the agent form: a typical prompt plus a turn of the given length. */
export function costPerTurnUsd(price: Price, maxOutputTokens = 220): number {
  return costUsd(price, 1_500, maxOutputTokens);
}

/** "$0.0004", "$0.012", "$1.20": enough digits to show fractions of a cent. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toPrecision(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}
