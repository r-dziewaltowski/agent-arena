import { and, asc, eq, gt, isNotNull, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { debateParticipants, debates, turns } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { commentsSince, commentViews } from "@/lib/chat";
import { viewTurns } from "@/lib/debate-view";
import { readingWordsPerSecond } from "@/lib/debate/pacing";
import { turnsCacheControl } from "@/lib/realtime/fetch-plan";

/**
 * Fetched by viewers while a debate is live (on pushed events and when a turn is due to start or
 * end, or every second while the stream is down): the debate's state plus every finished turn
 * after `after`, and the turn currently being written.
 * Turns are cut to the words viewers should have reached by now (see pacing.ts); a turn being shown
 * comes whole too, with its timing and speech, so the browser can reveal it smoothly (in step with
 * the audio when listening). `serverNow` lets the browser correct for its clock being off.
 * With `commentsSince` (the previous personal fetch's `serverNow`), it also returns the chat comments
 * posted, deleted or removed since then, marked with the viewer's own: a personal answer, never
 * cached. Without it but with a version `v` (realtime/fetch-plan.ts), the answer is the same for
 * everyone, so the CDN shares it for a couple of seconds.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/debates/[id]/turns">) {
  const { id } = await ctx.params;
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  const since = Number(request.nextUrl.searchParams.get("commentsSince") ?? "");
  const cacheControl = turnsCacheControl({ commentsSince: since, version: request.nextUrl.searchParams.get("v") });
  const db = await getDb();

  const [debate] = await db.select().from(debates).where(eq(debates.id, id));
  if (!debate) return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
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
  // New comments are rare next to polls: the viewer is looked up only when there are some.
  const newComments = since > 0 ? await commentsSince(db, id, since) : [];
  const comments = newComments.length ? await commentViews(db, id, newComments, (await getCurrentUser())?.id ?? null) : [];
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
      comments,
    },
    { headers: { "Cache-Control": cacheControl } },
  );
}
