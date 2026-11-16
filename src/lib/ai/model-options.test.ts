import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOption, getModelOptions } from "./model-options";

describe("getModelOptions", () => {
  beforeEach(() => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:9/api"); // nothing listens: no local models
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offers a provider's models only when its key is set", async () => {
    expect(await getModelOptions()).toEqual([]);

    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    const google = await getModelOptions();
    expect(google.map((g) => g.provider)).toEqual(["google"]);
    expect(google[0].models[0]).toMatchObject({ provider: "google", id: "gemini-3.5-flash-lite" }); // default first

    vi.stubEnv("GROQ_API_KEY", "test-key");
    const both = await getModelOptions();
    expect(both.map((g) => g.provider)).toEqual(["groq", "google"]);
    expect(defaultOption(both)).toMatchObject({ provider: "groq", id: "openai/gpt-oss-120b" }); // Groq stays the default
  });
});
