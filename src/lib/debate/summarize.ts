import { streamText } from "ai";
import { and, asc, eq, ne } from "drizzle-orm";
import { callSettings, type ModelResolver, type Provider } from "../ai/provider";
import type { Db } from "../db/client";
import { debateParticipants, debates, turns } from "../db/schema";

/** Turns each speaker always sees word for word; older ones are folded into the summary. */
export const CONTEXT_WINDOW = 6;
const SUMMARY_MAX_TOKENS = 300;

/**
 * Keeps prompts a bounded size in long debates. Once 2 × CONTEXT_WINDOW turns have built up past
 * the summary, all but the last CONTEXT_WINDOW are folded into a rolling summary (one extra model
 * call). Prompts then carry the summary plus the recent turns. A failed fold is skipped and
 * retried after a later turn; it never fails the debate.
 */
export async function maybeFoldSummary(
  db: Db,
  debateId: string,
  opts: { resolveModel: ModelResolver; provider: Provider; modelId: string },
): Promise<boolean> {
  const [debate] = await db.select().from(debates).where(eq(debates.id, debateId));
  if (!debate) return false;

  const done = await db
    .select()
    .from(turns)
    .where(and(eq(turns.debateId, debateId), eq(turns.status, "complete"), ne(turns.kind, "summary")))
    .orderBy(asc(turns.seq));
  const unsummarized = done.filter((t) => t.seq > debate.summaryThroughSeq);
  if (unsummarized.length < 2 * CONTEXT_WINDOW) return false;
  const toFold = unsummarized.slice(0, unsummarized.length - CONTEXT_WINDOW);

  const participants = await db
    .select({ id: debateParticipants.id, name: debateParticipants.name, side: debateParticipants.side })
    .from(debateParticipants)
    .where(eq(debateParticipants.debateId, debateId));
  // In a for-or-against debate each name carries its side, so the summary keeps the sides apart.
  const nameOf = new Map(participants.map((p) => [p.id, `${p.name ?? "Someone"}${p.side ? ` (${p.side})` : ""}`]));

  const prompt = [
    `Topic: ${debate.topic}`,
    debate.summary ? `Summary so far:\n${debate.summary}` : "",
    `New turns:\n${toFold.map((t) => `${nameOf.get(t.participantId ?? "") ?? "Someone"}: ${t.content}`).join("\n\n")}`,
    "Write an updated summary of the whole debate in at most 150 words: each participant's position, main arguments and any concessions, attributed by name. Plain prose, no preamble.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let streamError: unknown;
  let text = "";
  let usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined;
  try {
    const result = streamText({
      model: opts.resolveModel(opts.provider, opts.modelId),
      system: "You keep a neutral, factual running summary of a debate for its participants.",
      prompt,
      ...callSettings(opts.provider, opts.modelId, {
        temperature: 0.3,
        maxOutputTokens: SUMMARY_MAX_TOKENS,
        stopSequences: [],
      }),
      maxRetries: 0,
      onError: ({ error }) => {
        streamError ??= error;
      },
    });
    for await (const delta of result.textStream) text += delta;
    if (!streamError) usage = await result.usage;
  } catch (err) {
    streamError ??= err;
  }
  const summary = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (streamError || !summary) return false;

  await db
    .update(debates)
    .set({
      summary,
      summaryThroughSeq: toFold[toFold.length - 1].seq,
      totalPromptTokens: debate.totalPromptTokens + (usage?.inputTokens ?? Math.ceil(prompt.length / 4)),
      totalCompletionTokens: debate.totalCompletionTokens + (usage?.outputTokens ?? Math.ceil(summary.length / 4)),
    })
    .where(eq(debates.id, debateId));
  return true;
}
