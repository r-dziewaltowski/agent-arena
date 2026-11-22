import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { debates } from "@/lib/db/schema";
import { streamUrlFor } from "@/lib/realtime/publish";

/**
 * Where a browser should listen for a debate's events: `{ url }` to open with `EventSource`
 * (Ably's address with a token that can only listen to this debate, or the local stream), or
 * `{ url: null }` when there's no push here, so the page polls. Asked again when a connection
 * drops, which also replaces an expired token.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/debates/[id]/events/connect">) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [debate] = await db.select({ id: debates.id }).from(debates).where(eq(debates.id, id));
  if (!debate) return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let url: string | null = null;
  try {
    url = await streamUrlFor(id);
  } catch (err) {
    // Ably refused or is down: this browser polls instead.
    console.error(`[realtime] debate ${id}: no stream address`, err instanceof Error ? err.message : err);
  }
  return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
