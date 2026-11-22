/**
 * Checks the Ably setup end to end, the way the app uses it: gets a listen-only token for a
 * throwaway channel, opens its event stream, publishes one event and waits for it to arrive.
 * Reads ABLY_API_KEY from the shell or .env.local; never prints it.
 *
 *   npm run realtime:check
 */
import "./load-env";
import { randomUUID } from "node:crypto";
import { ablyKey, ablyStreamUrl, publishToAbly } from "../src/lib/realtime/ably";

async function main() {
  const key = ablyKey();
  if (!key) {
    console.error(process.env.ABLY_API_KEY ? "ABLY_API_KEY doesn't look like an Ably key (appId.keyId:secret)." : "ABLY_API_KEY is not set.");
    process.exit(1);
  }
  console.log(`ABLY_API_KEY: key ${key.slice(0, key.indexOf(":"))} (secret hidden)`);

  const debateId = `check-${randomUUID()}`;
  const url = await ablyStreamUrl(key, debateId);
  console.log("Token: issued (listen-only, one channel)");

  const controller = new AbortController();
  const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`the event stream answered ${res.status}: ${await res.text()}`);
  console.log(`Stream: open (CORS allow-origin: ${res.headers.get("access-control-allow-origin") ?? "none"})`);

  const sentAt = Date.now();
  const event = JSON.stringify({ type: "turns" });
  // Give the subscription a moment to attach before publishing.
  setTimeout(() => publishToAbly(key, debateId, "turns", event).catch((err) => console.error("Publish failed:", err.message)), 500);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the stream closed before the event arrived");
      buffer += value;
      for (const block of buffer.split("\n\n").slice(0, -1)) {
        const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
        const kind = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        if (kind === "error") throw new Error(`Ably sent an error: ${data}`);
        if (data === event) {
          console.log(`Event: received ${Date.now() - sentAt - 500} ms after publishing. Ably works for live updates.`);
          return;
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

main().catch((err) => {
  console.error(`Ably check failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
