import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { openDb, type Db } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import { agents, user } from "../lib/db/schema";
import type { ModelResolver } from "../lib/ai/provider";

/** Test databases live here; the global teardown removes the folder after the run. */
export const TEST_DB_DIR = join(tmpdir(), "agent-arena-tests");

/** A fresh database in a temp file with migrations applied. Call `cleanup` when done. */
export async function createTestDb(): Promise<{ db: Db; cleanup: () => void }> {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  const path = join(TEST_DB_DIR, `${randomUUID()}.db`);
  const { db, client } = await openDb(`file:${path.replaceAll("\\", "/")}`);
  await runMigrations(db);
  // Deleting right after close is slow on Windows, which keeps the file locked briefly.
  return { db, cleanup: () => client.close() };
}

export async function seedUser(db: Db, id: string, opts: { isAdmin?: boolean } = {}) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.test`,
    displayName: id,
    isAdmin: opts.isAdmin ?? false,
  });
  return id;
}

export async function seedAgent(
  db: Db,
  ownerId: string,
  overrides: Partial<typeof agents.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await db.insert(agents).values({
    id,
    ownerId,
    name: `Agent ${id.slice(0, 4)}`,
    persona: "A thoughtful person with strong opinions about city life.",
    style: "analytical",
    tone: "formal",
    stance: "neutral",
    provider: "ollama",
    modelId: "test-model",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });
  return id;
}

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

type Reply = string | { text: string; finishReason?: "stop" | "length"; inputTokens?: number; outputTokens?: number };

/** A fake model that streams the given replies in order (the last one repeats). */
export function scriptedModel(replies: Reply[]): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const raw = replies[Math.min(call++, replies.length - 1)];
      const reply = typeof raw === "string" ? { text: raw } : raw;
      const words = reply.text.split(/(?<= )/);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "t" },
            ...words.map((w) => ({ type: "text-delta" as const, id: "t", delta: w })),
            { type: "text-end" as const, id: "t" },
            {
              type: "finish" as const,
              finishReason: { unified: reply.finishReason ?? "stop", raw: undefined },
              logprobs: undefined,
              usage: usage(reply.inputTokens ?? 100, reply.outputTokens ?? 50),
            },
          ],
        }),
      };
    },
  });
}

/** A fake model whose calls fail as if Ollama weren't running. */
export function unreachableModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" }),
      });
    },
  });
}

/** A fake model whose calls fail with HTTP 429, as when a free tier's limit is reached. */
export function rateLimitedModel(retryAfterSeconds?: number): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: "Rate limit reached for model",
        url: "https://api.groq.com/openai/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
        isRetryable: true,
      });
    },
  });
}

export function resolverFor(model: MockLanguageModelV4): ModelResolver {
  return () => model;
}

/** A controllable clock for tests. */
export function testClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
