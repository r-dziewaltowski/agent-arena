import { and, asc, eq, gt, isNotNull, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { debateParticipants, debates, turns } from "@/lib/db/schema";
import { viewTurns } from "@/lib/debate-view";
import { readingWordsPerSecond } from "@/lib/debate/pacing";

/**
 * Polled by viewers about once a second while a debate runs: the debate's state plus every
 * finished turn after `after`, and the turn currently being written (its text grows each poll).
 * Turns are cut to the words viewers should have reached by now (see pacing.ts); a turn being shown
 * comes whole too, with its timing and speech, so the browser can reveal it smoothly (in step with
 * the audio when listening). `serverNow` lets the browser correct for its clock being off.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/debates/[id]/turns">) {
  const { id } = await ctx.params;
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  const db = await getDb();

  const [debate] = await db.select().from(debates).where(eq(debates.id, id));
  if (!debate) return Response.json({ error: "Not found" }, { status: 404 });
  const now = Date.now();

  const rows = await db
    .select()
    .from(turns)
    .where(and(eq(turns.debateId, id), or(gt(turns.seq, after), eq(turns.status, "streaming"))))
    .orderBy(asc(turns.seq));
  // Agents that can't speak any more (their owner's paid-model key stopped working).
  const silenced = await db
    .select({ participantId: debateParticipants.id, reason: debateParticipants.silencedReason })
    .from(debateParticipants)
    .where(and(eq(debateParticipants.debateId, id), isNotNull(debateParticipants.silencedAt)));

  const wordsPerSecond = readingWordsPerSecond();
  const { turns: visible, upcoming } = viewTurns(rows, now, wordsPerSecond);
  return Response.json(
    {
      status: debate.status,
      currentRound: debate.currentRound,
      rounds: debate.rounds,
      waitingReason: debate.waitingReason,
      nextAttemptAt: debate.nextAttemptAt,
      totalPromptTokens: debate.totalPromptTokens,
      totalCompletionTokens: debate.totalCompletionTokens,
      turns: visible,
      upcoming,
      serverNow: now,
      silenced,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
