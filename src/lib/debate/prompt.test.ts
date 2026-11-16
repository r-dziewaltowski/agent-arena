import { describe, expect, it } from "vitest";
import { callSettings, resolveSettings } from "../ai/provider";
import {
  buildPrompt,
  cleanTurnText,
  disambiguateNames,
  trimToLastSentence,
  turnKindFor,
  type Speaker,
} from "./prompt";
import { CUSTOM_TRAIT, styleSentence, submittedTrait, toneSentence, stanceOf, STYLE_PRESETS } from "./traits";

const ada: Speaker = { id: "a", name: "Ada", persona: "An urban planner.", style: "analytical", tone: "formal", stance: "contrarian" };
const bram: Speaker = { id: "b", name: "Bram", persona: "A taxi driver.", style: "quotes old proverbs", tone: "dry", stance: "agreeable" };
const cleo: Speaker = { id: "c", name: "Cleo", persona: "A cyclist.", style: "pragmatic", tone: "warm", stance: "mediator" };

describe("turnKindFor", () => {
  it("opens in round 1, closes in the last round and argues in between", () => {
    expect(turnKindFor(1, 3)).toBe("opening");
    expect(turnKindFor(2, 3)).toBe("argument");
    expect(turnKindFor(3, 3)).toBe("closing");
    expect(turnKindFor(2, 2)).toBe("closing");
  });
});

describe("traits", () => {
  it("uses the tuned sentence for presets and a fixed frame for custom text", () => {
    expect(styleSentence("analytical")).toBe(STYLE_PRESETS.analytical);
    expect(styleSentence("  quotes old proverbs ")).toBe("Your rhetorical style: quotes old proverbs.");
    expect(toneSentence("grumpy but fair")).toBe("Your tone: grumpy but fair.");
  });

  it("falls back to neutral for an unknown stance", () => {
    expect(stanceOf("something else")).toEqual(stanceOf("neutral"));
  });
});

describe("buildPrompt", () => {
  it("puts identity and rules in the system prompt", () => {
    const p = buildPrompt({
      topic: "Ban cars?",
      rounds: 3,
      round: 1,
      kind: "opening",
      speaker: bram,
      participants: [ada, bram],
      turns: [],
      othersSpokeThisRound: false,
    });
    expect(p.system).toContain("You are Bram");
    expect(p.system).toContain("A taxi driver.");
    expect(p.system).toContain("Your rhetorical style: quotes old proverbs.");
    expect(p.system).toContain("The other participants: Ada.");
    expect(p.stopSequences).toEqual(["\nAda:"]);
  });

  it("asks for a length the model can finish within its token cap", () => {
    const p = buildPrompt({
      topic: "Ban cars?",
      rounds: 3,
      round: 1,
      kind: "opening",
      speaker: ada,
      participants: [ada, bram],
      turns: [],
      othersSpokeThisRound: false,
      maxOutputTokens: 220,
    });
    expect(p.system).toContain("Keep it under 130 words");
  });

  it("shows own turns as assistant, others' as named user turns, merging consecutive ones", () => {
    const p = buildPrompt({
      topic: "Ban cars?",
      rounds: 3,
      round: 2,
      kind: "argument",
      speaker: ada,
      participants: [ada, bram, cleo],
      turns: [
        { participantId: "a", content: "Cars must go." },
        { participantId: "b", content: "Not so fast." },
        { participantId: "c", content: "Let's meet halfway." },
      ],
      othersSpokeThisRound: false,
    });
    expect(p.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(p.messages[1].content).toBe("Cars must go.");
    const last = p.messages[2].content as string;
    expect(last).toContain("Bram: Not so fast.");
    expect(last).toContain("Cleo: Let's meet halfway.");
    expect(last).toContain("Round 2 of 3.");
    expect(last).toContain("Challenge the strongest point"); // Ada is contrarian
    expect(p.stopSequences).toEqual(["\nBram:", "\nCleo:"]);
  });

  it("asks for a closing statement in the last round", () => {
    const p = buildPrompt({
      topic: "Ban cars?",
      rounds: 2,
      round: 2,
      kind: "closing",
      speaker: ada,
      participants: [ada, bram],
      turns: [],
      othersSpokeThisRound: true,
    });
    expect(p.messages.at(-1)?.content).toContain("closing statement");
  });
});

describe("cleanTurnText", () => {
  it("strips a leading name label and reasoning blocks", () => {
    expect(cleanTurnText("Ada: Hello there.", "Ada")).toBe("Hello there.");
    expect(cleanTurnText("**Ada:** Hello.", "Ada")).toBe("Hello.");
    expect(cleanTurnText("<think>plan</think>\nHello.", "Ada")).toBe("Hello.");
    expect(cleanTurnText("<think>never closed", "Ada")).toBe("");
    expect(cleanTurnText("Adam: keeps other names", "Ada")).toBe("Adam: keeps other names");
  });
});

describe("trimToLastSentence", () => {
  it("drops an unfinished last sentence", () => {
    expect(trimToLastSentence("First point. Second point. Third poi")).toBe("First point. Second point.");
  });
  it("leaves complete text alone", () => {
    expect(trimToLastSentence("All done!")).toBe("All done!");
  });
  it("adds an ellipsis when trimming would lose most of the text", () => {
    expect(trimToLastSentence("Yes. And then a very long unfinished thought that goes on")).toMatch(/…$/);
  });
});

describe("disambiguateNames", () => {
  it("suffixes later duplicates, case-insensitively, without creating new clashes", () => {
    expect(disambiguateNames(["Socrates", "Ada", "socrates"])).toEqual(["Socrates", "Ada", "socrates (2)"]);
    expect(disambiguateNames(["A", "A (2)", "A"])).toEqual(["A", "A (2)", "A (3)"]);
  });
});

describe("resolveSettings and callSettings", () => {
  it("maps labels to provider-specific numbers", () => {
    expect(resolveSettings("ollama", "wild", "long")).toEqual({ temperature: 1.3, maxOutputTokens: 400 });
    expect(resolveSettings("anthropic", "wild", "short")).toEqual({ temperature: 1.0, maxOutputTokens: 120 });
  });

  it("gives Groq the same temperatures as Ollama, with minimal hidden reasoning per model family", () => {
    expect(resolveSettings("groq", "wild", "medium")).toEqual({ temperature: 1.3, maxOutputTokens: 220 });
    const base = { temperature: 0.7, maxOutputTokens: 220, stopSequences: ["\nBram:"] };
    expect(callSettings("groq", "openai/gpt-oss-120b", base)).toEqual({
      ...base,
      providerOptions: { groq: { reasoningEffort: "low", reasoningFormat: "hidden" } },
    });
    expect(callSettings("groq", "qwen/qwen3.8-27b", base).providerOptions?.groq?.reasoningEffort).toBe("none");
    expect(callSettings("groq", "some-other-model", base)).toEqual(base);
  });

  it("gives Google the same temperatures, with minimal thinking for Gemini and none for Gemma", () => {
    expect(resolveSettings("google", "focused", "short")).toEqual({ temperature: 0.3, maxOutputTokens: 120 });
    const base = { temperature: 0.7, maxOutputTokens: 220, stopSequences: ["\nBram:"] };
    expect(callSettings("google", "gemini-3.5-flash-lite", base)).toEqual({
      ...base,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } },
    });
    expect(callSettings("google", "gemini-9-unknown", base).providerOptions?.google?.thinkingConfig.thinkingLevel).toBe("minimal");
    expect(callSettings("google", "gemma-4-31b-it", base)).toEqual(base); // Gemma: not in the catalog, no setting guessed
  });

  it("sends Ollama its native options", () => {
    const s = callSettings("ollama", "llama3.2", { temperature: 0.7, maxOutputTokens: 220, stopSequences: ["\nBram:"] });
    expect(s.providerOptions?.ollama?.options).toEqual({ temperature: 0.7, num_predict: 220, stop: ["\nBram:"] });
    expect(s.stopSequences).toBeUndefined();
  });
});

describe("submittedTrait", () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  it("uses the chosen preset, or the owner's own text for 'Write your own…'", () => {
    expect(submittedTrait(form({ styleChoice: "socratic", styleCustom: "ignored" }), "style")).toBe("socratic");
    expect(submittedTrait(form({ toneChoice: CUSTOM_TRAIT, toneCustom: "cheerfully blunt" }), "tone")).toBe("cheerfully blunt");
    expect(submittedTrait(form({ style: "dry" }), "style")).toBe("dry"); // older forms
  });
});
