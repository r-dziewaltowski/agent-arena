/**
 * A scripted stand-in for a real model, for the end-to-end tests: turns stream instantly and
 * cost nothing, so a whole debate runs in seconds without any API key. Switched on only by
 * E2E_FAKE_MODEL=1 and never on Vercel, so a stray variable can't fake production debates.
 */
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

export function fakeModelsEnabled(): boolean {
  return process.env.E2E_FAKE_MODEL === "1" && !process.env.VERCEL;
}

let calls = 0;

export function fakeModel(): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async () => {
      const n = ++calls;
      const text = `Scripted argument ${n}. Cities work best when policy follows evidence, and this point stands on its own.`;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "t" },
            ...text.split(/(?<= )/).map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
            { type: "text-end" as const, id: "t" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 30, text: 30, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
}
