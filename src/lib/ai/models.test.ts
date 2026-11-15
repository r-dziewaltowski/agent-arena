import { describe, expect, it } from "vitest";
import { catalogAvailability, findModel, MODEL_CATALOG, normalizeOllamaName, offeredModels } from "./models";
import { defaultModelFor, groqReasoningOptions, type Provider } from "./provider";

describe("model catalog", () => {
  it("has exactly one offered default per catalog provider, matching defaultModelFor", () => {
    const providers = [...new Set(MODEL_CATALOG.map((m) => m.provider))] as Provider[];
    for (const provider of providers) {
      const defaults = offeredModels(provider).filter((m) => m.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaultModelFor(provider)).toBe(defaults[0].id);
      expect(offeredModels(provider)[0].isDefault).toBe(true); // default listed first
    }
  });

  it("hides retired models from the picker", () => {
    expect(findModel("groq", "llama-3.3-70b-versatile")?.offered).toBe(false);
    expect(offeredModels("groq").map((m) => m.id)).not.toContain("llama-3.3-70b-versatile");
  });

  it("takes reasoning settings from the catalog, guessing only for unknown ids", () => {
    expect(groqReasoningOptions("qwen/qwen3.8-27b")?.reasoningEffort).toBe("none");
    expect(groqReasoningOptions("llama-3.3-70b-versatile")).toBeUndefined();
    expect(groqReasoningOptions("openai/gpt-oss-999b")?.reasoningEffort).toBe("low");
  });
});

describe("catalogAvailability", () => {
  it("treats only known-retired catalog models as unavailable", () => {
    const a = catalogAvailability();
    expect(a.isAvailable("groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(a.isAvailable("groq", "openai/gpt-oss-120b")).toBe(true);
    expect(a.isAvailable("groq", "something-new")).toBe(true);
  });

  it("checks Ollama models against the installed list, or allows them when Ollama is unreachable", () => {
    expect(catalogAvailability(["llama3.2:latest"]).isAvailable("ollama", "llama3.2")).toBe(true);
    expect(catalogAvailability(["llama3.2:latest"]).isAvailable("ollama", "mistral")).toBe(false);
    expect(catalogAvailability(null).isAvailable("ollama", "mistral")).toBe(true);
    expect(normalizeOllamaName("qwen3:4b")).toBe("qwen3:4b");
  });
});
