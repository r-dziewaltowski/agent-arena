import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { advanceDebate, type AdvanceResult } from "@/lib/jobs/advance";
import { ADVANCE_PATH, getQueue } from "@/lib/jobs/queue";
import { isQueueRequest, jobLog } from "@/lib/jobs/verify";

/** Vercel Hobby allows up to 300 s; a turn takes seconds on Groq, up to a minute on a cold local Ollama. */
export const maxDuration = 300;

const messageSchema = z.object({ debateId: z.string().min(1) });

/** Called only by the queue: one step of one debate, then the next message is queued. */
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await isQueueRequest(request, body, ADVANCE_PATH))) {
    return new Response("Invalid signature", { status: 401 });
  }
  const parsed = messageSchema.safeParse(safeJson(body));
  // A malformed message would fail the same way on every retry, so accept and drop it.
  if (!parsed.success) return new Response("Ignored: malformed message", { status: 200 });

  const { debateId } = parsed.data;
  try {
    const db = await getDb();
    const result = await advanceDebate(db, debateId, {
      queue: getQueue(),
      onTurnStart: ({ speaker, round, rounds, kind, seq }) =>
        jobLog(`debate ${debateId}: turn ${seq} by ${speaker} (round ${round}/${rounds}, ${kind})`),
    });
    jobLog(`debate ${debateId}: ${describe(result)}`);
    return Response.json(result);
  } catch (err) {
    // Unexpected (e.g. the database is unreachable): a 5xx makes QStash retry the message.
    console.error(`[jobs] debate ${debateId}: advance failed`, err);
    return new Response("Advance failed", { status: 500 });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function describe(result: AdvanceResult): string {
  const when = (at: number | "now" | null) =>
    at === null ? "" : at === "now" ? "; next step queued" : `; next try at ${new Date(at).toLocaleTimeString()}`;
  switch (result.kind) {
    case "gone":
      return "no longer exists";
    case "idle":
      return `nothing to do (${result.status})`;
    case "not_due":
      return `not due yet; queued for ${new Date(result.requeuedFor).toLocaleString()}`;
    case "cancelled":
      return "cancelled (fewer than 2 agents at the start time)";
    case "step": {
      const o = result.outcome;
      switch (o.kind) {
        case "turn":
          return o.debateCompleted ? "completed" : `turn ${o.seq} saved${when(result.requeuedFor)}`;
        case "waiting":
          return `model unavailable (${o.error})${when(result.requeuedFor)}`;
        case "retrying":
          return `bad turn (${o.error}); retry ${o.retryCount}${when(result.requeuedFor)}`;
        case "failed":
          return `failed: ${o.error}`;
        case "skipped":
          return `skipped (another step is running or it isn't due)${when(result.requeuedFor)}`;
      }
    }
  }
}
