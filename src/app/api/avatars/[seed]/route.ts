import { createAvatar } from "@dicebear/core";
import * as notionists from "@dicebear/notionists";
import { MAX_SEED_LENGTH } from "@/lib/avatars";

/** Soft backgrounds for generated faces, which work in light and dark themes alike. */
const BACKGROUNDS = ["c7d2fe", "a7f3d0", "fde68a", "fecdd3", "bae6fd", "ddd6fe"];

/**
 * A generated face (DiceBear "Notionists", CC0 artwork) for an agent without an uploaded picture.
 * The same seed always gives the same face, so it may be cached for good.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/avatars/[seed]">) {
  const { seed } = await ctx.params;
  const svg = createAvatar(notionists, {
    seed: seed.slice(0, MAX_SEED_LENGTH), // already decoded
    backgroundColor: BACKGROUNDS,
  }).toString();
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
      // Only ever a picture: nothing in it may run if it's opened on its own.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
