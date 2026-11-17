import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { turnAudio } from "@/lib/db/schema";
import { parseRange } from "@/lib/http-range";

/**
 * A turn's speech (MP3), for listeners of a live debate. It exists only while the debate is live
 * (see `voice/cleanup.ts`); afterwards this answers 404. Supports byte ranges, so a listener who
 * joins mid-turn can start from the middle. Never changes once made, so the CDN may keep it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/debates/[id]/turns/[turnId]/audio">) {
  const { id, turnId } = await ctx.params;
  const db = await getDb();
  const [row] = await db
    .select({ data: turnAudio.data, mimeType: turnAudio.mimeType })
    .from(turnAudio)
    .where(and(eq(turnAudio.turnId, turnId), eq(turnAudio.debateId, id)));
  if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const body = new Uint8Array(row.data);
  const headers: Record<string, string> = {
    "Content-Type": row.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=600, immutable",
  };
  const range = parseRange(request.headers.get("range"), body.length);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${body.length}` } });
  }
  if (range) {
    const [start, end] = range;
    return new Response(body.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(body, { headers: { ...headers, "Content-Length": String(body.length) } });
}
