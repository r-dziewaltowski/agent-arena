/**
 * Ably, the hosted service that holds viewers' open connections in production (Vercel functions
 * shouldn't). No SDK: the server publishes with one HTTP call and hands browsers a Server-Sent
 * Events address with a short-lived token that can only listen to one debate's channel.
 * https://ably.com/docs/api/rest-api, https://ably.com/docs/api/sse
 *
 * `ABLY_API_KEY` ("appId.keyId:secret", from the Ably dashboard) turns it on. Without it the app
 * falls back to the local stream (development, tests) or to polling (Vercel without a key).
 */
import { untrackedFetch } from "../db/client";
import { channelFor } from "./events";

const HOST = "https://main.realtime.ably.net";
/** Tokens live an hour; one is shared by everyone watching the same debate. */
const TOKEN_TTL_MS = 60 * 60_000;
/** A cached token is handed out only while it has this long left, so a new connection lasts a while. */
const TOKEN_MIN_LEFT_MS = 10 * 60_000;
/** Publishing must never hold up a turn or an action for long. */
const PUBLISH_TIMEOUT_MS = 2_000;
/**
 * Ably apps can require every connection and publish to be identified (a `clientId`); new apps
 * did (2026-11-22, with no rule to untick). The server publishes as itself, and viewers, who
 * watch anonymously, listen under one shared identity, so one token serves a whole audience.
 */
const SERVER_CLIENT_ID = "agent-arena-server";
const VIEWER_CLIENT_ID = "viewer";

export function ablyKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.ABLY_API_KEY?.trim();
  return key && /^[^.:\s]+\.[^.:\s]+:\S+$/.test(key) ? key : null;
}

function basicAuth(key: string): string {
  return `Basic ${Buffer.from(key).toString("base64")}`;
}

/** Sends one message to a debate's channel. Throws on failure; the caller decides what to do. */
export async function publishToAbly(key: string, debateId: string, name: string, data: string): Promise<void> {
  const res = await untrackedFetch(`${HOST}/channels/${encodeURIComponent(channelFor(debateId))}/messages`, {
    method: "POST",
    headers: {
      authorization: basicAuth(key),
      "content-type": "application/json",
      "x-ably-clientid": Buffer.from(SERVER_CLIENT_ID).toString("base64"),
    },
    body: JSON.stringify({ name, data }),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ably publish failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

type CachedToken = { token: string; expires: number };
const TOKENS_KEY = Symbol.for("agent-arena.ably-tokens");

function tokenCache(): Map<string, CachedToken> {
  const g = globalThis as { [TOKENS_KEY]?: Map<string, CachedToken> };
  return (g[TOKENS_KEY] ??= new Map());
}

/** A token that can only listen to one debate's channel, reused while it has a while left. */
async function listenToken(key: string, debateId: string, now: number): Promise<string> {
  const cache = tokenCache();
  const cached = cache.get(debateId);
  if (cached && cached.expires - now > TOKEN_MIN_LEFT_MS) return cached.token;

  const keyName = key.slice(0, key.indexOf(":"));
  const res = await untrackedFetch(`${HOST}/keys/${encodeURIComponent(keyName)}/requestToken`, {
    method: "POST",
    headers: { authorization: basicAuth(key), "content-type": "application/json" },
    // Unsigned token requests are allowed with Basic auth (no nonce/mac signing needed).
    body: JSON.stringify({
      keyName,
      ttl: TOKEN_TTL_MS,
      capability: JSON.stringify({ [channelFor(debateId)]: ["subscribe"] }),
      clientId: VIEWER_CLIENT_ID,
      timestamp: now,
      nonce: crypto.randomUUID().replaceAll("-", ""),
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Ably token request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const details = (await res.json()) as { token?: string; expires?: number };
  if (!details.token) throw new Error("Ably token request returned no token");
  const token = { token: details.token, expires: details.expires ?? now + TOKEN_TTL_MS };
  // Old entries go when they expire, so the cache stays small.
  for (const [id, t] of cache) if (t.expires <= now) cache.delete(id);
  cache.set(debateId, token);
  return token.token;
}

/**
 * The address a browser opens with `EventSource` to hear one debate. `enveloped=false` makes each
 * event's data the message we published (our JSON), the same as the local stream sends.
 */
export async function ablyStreamUrl(key: string, debateId: string, now = Date.now()): Promise<string> {
  const params = new URLSearchParams({
    v: "1.2",
    channels: channelFor(debateId),
    enveloped: "false",
    accessToken: await listenToken(key, debateId, now),
  });
  return `${HOST}/sse?${params}`;
}
