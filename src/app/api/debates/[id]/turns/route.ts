import { and, asc, eq, gt, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { debates, turns } from "@/lib/db/schema";
import { toTurnView } from "@/lib/debate-view";

/**
 * Polled by viewers about once a second while a debate runs: the debate's state plus every
 * finished turn after `after`, and the turn currently being written (its text grows each poll).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/debates/[id]/turns">) {
  const { id } = await ctx.params;
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  const db = await getDb();

  const [debate] = await db.select().from(debates).where(eq(debates.id, id));
  if (!debate) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(turns)
    .where(and(eq(turns.debateId, id), or(gt(turns.seq, after), eq(turns.status, "streaming"))))
    .orderBy(asc(turns.seq));

  return Response.json(
    {
      status: debate.status,
      currentRound: debate.currentRound,
      rounds: debate.rounds,
      waitingReason: debate.waitingReason,
      nextAttemptAt: debate.nextAttemptAt,
      totalPromptTokens: debate.totalPromptTokens,
      totalCompletionTokens: debate.totalCompletionTokens,
      turns: rows.filter((t) => t.kind !== "summary").map(toTurnView),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
