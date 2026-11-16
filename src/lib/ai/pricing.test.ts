import { describe, expect, it } from "vitest";
import { costPerTurnUsd, costUsd, formatUsd, priceOf } from "./pricing";

describe("pricing", () => {
  it("prices paid catalog models only", () => {
    expect(priceOf("openrouter", "anthropic/claude-haiku-5.5")).toEqual({ input: 0.1, output: 0.5 });
    expect(priceOf("groq", "openai/gpt-oss-120b")).toBeNull();
    expect(priceOf("ollama", "llama3.2")).toBeNull();
    expect(priceOf(null, null)).toBeNull();
  });

  it("computes and formats costs", () => {
    expect(costUsd({ input: 2, output: 10 }, 1_000_000, 100_000)).toBe(3);
    expect(costPerTurnUsd({ input: 0.1, output: 0.5 })).toBeCloseTo(0.00026);
    expect(formatUsd(0.00026)).toBe("$0.00026");
    expect(formatUsd(0.012)).toBe("$0.012");
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatUsd(0)).toBe("$0");
  });
});
