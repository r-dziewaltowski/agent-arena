import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agentImages } from "@/lib/db/schema";

/**
 * An agent's uploaded picture. Public, like its name: it shows wherever the agent appears. Its
 * address carries the version (`?v=`), so a changed picture shows at once under its new address.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/agents/[id]/image">) {
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.select().from(agentImages).where(eq(agentImages.agentId, id));
  if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mimeType,
      // A day, not for good: a picture removed by its owner (or an admin) should stop showing soon.
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
