import { listen, localStreamAllowed } from "@/lib/realtime/publish";

/** A comment line now and then keeps proxies and the browser from closing a quiet stream. */
const KEEPALIVE_MS = 15_000;

/**
 * The local stand-in for Ably: one debate's events as Server-Sent Events, straight from this
 * process. Used in development and the end-to-end tests, where one long-running server handles
 * every request. On Vercel each request may run in a different function, so it isn't offered
 * there (browsers get Ably's address instead, or poll). See lib/realtime.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/debates/[id]/events">) {
  if (!localStreamAllowed()) return new Response("Not available here", { status: 404 });
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop(); // the browser went away
        }
      };
      const unlisten = listen(id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      stop = () => {
        unlisten();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => stop());
      send(": connected\n\n");
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: Next's compression would otherwise hold events back.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
