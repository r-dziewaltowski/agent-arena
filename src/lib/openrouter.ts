import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { providerConnections } from "./db/schema";
import { decryptSecret, encryptSecret, sha256Hex } from "./secrets";

/**
 * Connecting a user's OpenRouter account (OAuth PKCE): the user approves on OpenRouter, comes back
 * with a one-time code, and the server swaps it for an API key that spends the user's own credit.
 * OPENROUTER_URL can point elsewhere for tests (a fake OpenRouter).
 */
export function openRouterUrl(): string {
  return (process.env.OPENROUTER_URL || "https://openrouter.ai").replace(/\/$/, "");
}

/** The PKCE pair and a CSRF state for one connect attempt. */
export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
  };
}

export function authorizeUrl(args: { callbackUrl: string; challenge: string; state: string }): string {
  const url = new URL(`${openRouterUrl()}/auth`);
  url.searchParams.set("callback_url", args.callbackUrl);
  url.searchParams.set("code_challenge", args.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", args.state);
  url.searchParams.set("key_label", "Agent Arena");
  return url.toString();
}

/** Swaps the one-time code (valid 10 minutes) for the user's key. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${openRouterUrl()}/api/v1/auth/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter refused the code (${res.status}).`);
  const { key } = (await res.json()) as { key?: unknown };
  if (typeof key !== "string" || !key) throw new Error("OpenRouter's answer had no key.");
  return key;
}

/** Where OpenRouter sends the user back (src/app/api/openrouter/callback/route.ts). */
export const CALLBACK_PATH = "/api/openrouter/callback";

/** The short-lived cookie that carries the PKCE verifier from "Connect" to the callback. */
export const PKCE_COOKIE = "openrouter_pkce";
export const PKCE_COOKIE_MAX_AGE_S = 10 * 60;
type PkceCookie = { verifier: string; state: string; userId: string; expiresAt: number };

export function sealPkceCookie(value: Omit<PkceCookie, "expiresAt">, now = Date.now()): string {
  return encryptSecret(JSON.stringify({ ...value, expiresAt: now + PKCE_COOKIE_MAX_AGE_S * 1000 }));
}

/** The verifier, if the cookie is genuine, unexpired, and for this user and state. */
export function openPkceCookie(sealed: string | undefined, args: { state: string; userId: string }, now = Date.now()): string | null {
  if (!sealed) return null;
  try {
    const value = JSON.parse(decryptSecret(sealed)) as PkceCookie;
    if (value.state !== args.state || value.userId !== args.userId || value.expiresAt < now) return null;
    return value.verifier;
  } catch {
    return null;
  }
}

export type ConnectionStatus = {
  connectedAt: number;
  /** OpenRouter's page where the owner can see usage, set a limit or revoke the key. */
  manageUrl: string;
  failedAt: number | null;
  failReason: string | null;
};

export async function saveConnection(db: Db, userId: string, key: string, now = Date.now()): Promise<void> {
  const values = { encryptedKey: encryptSecret(key), keyHash: sha256Hex(key), createdAt: now, lastUsedAt: null, failedAt: null, failReason: null };
  await db
    .insert(providerConnections)
    .values({ id: randomUUID(), userId, provider: "openrouter", ...values })
    .onConflictDoUpdate({ target: [providerConnections.userId, providerConnections.provider], set: values });
}

export async function getConnection(db: Db, userId: string): Promise<ConnectionStatus | null> {
  const [row] = await db.select().from(providerConnections).where(byUser(userId));
  if (!row) return null;
  return {
    connectedAt: row.createdAt,
    manageUrl: `https://openrouter.ai/keys/${row.keyHash}`,
    failedAt: row.failedAt,
    failReason: row.failReason,
  };
}

/** The owner's key for making a call, or null if they aren't connected. Server-side only. */
export async function loadKey(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ encryptedKey: providerConnections.encryptedKey }).from(providerConnections).where(byUser(userId));
  return row ? decryptSecret(row.encryptedKey) : null;
}

export async function markKeyUsed(db: Db, userId: string, now = Date.now()): Promise<void> {
  await db.update(providerConnections).set({ lastUsedAt: now, failedAt: null, failReason: null }).where(byUser(userId));
}

export async function markKeyFailed(db: Db, userId: string, reason: string, now = Date.now()): Promise<void> {
  await db.update(providerConnections).set({ failedAt: now, failReason: reason }).where(byUser(userId));
}

export async function deleteConnection(db: Db, userId: string): Promise<void> {
  await db.delete(providerConnections).where(byUser(userId));
}

function byUser(userId: string) {
  return and(eq(providerConnections.userId, userId), eq(providerConnections.provider, "openrouter"));
}

/** A 429 lifting later than this is the account's daily free limit, not a per-minute one. */
const DAILY_LIMIT_THRESHOLD_MS = 10 * 60_000;

/**
 * OpenRouter's answer when the owner's account can't be used for now: 401 (key invalid or
 * revoked), 402 (out of credit), 403 (the key's spending limit reached), or a 429 for its daily
 * free requests being used up. These silence the owner's agent instead of making everyone in the
 * debate wait or fail. Other 429s (the per-minute limit, or a busy model host) clear up within
 * minutes and keep the usual wait-and-retry. Returns a reason fit to show publicly, or null.
 */
export function keyRefusalReason(err: unknown, now = Date.now()): string | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const status = (e as { statusCode?: unknown }).statusCode;
    if (status === 401) return "its owner's OpenRouter key was revoked or isn't valid";
    if (status === 402) return "its owner's OpenRouter account is out of credit";
    if (status === 403) return "its owner's OpenRouter key reached its spending limit";
    if (status === 429 && dailyLimitReached(e as RateLimitError, now)) return "its owner's OpenRouter account used up today's free requests";
  }
  return null;
}

type RateLimitError = { message?: string; responseBody?: string; responseHeaders?: Record<string, string | undefined> };

/** OpenRouter says when the limit lifts (X-RateLimit-Reset, epoch ms); the daily one is hours away. */
function dailyLimitReached(e: RateLimitError, now: number): boolean {
  const header = Object.entries(e.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === "x-ratelimit-reset")?.[1];
  const reset = Number(header);
  if (Number.isFinite(reset) && reset > 0) {
    const resetMs = reset < 1e12 ? reset * 1000 : reset; // tolerate seconds
    if (resetMs - now > DAILY_LIMIT_THRESHOLD_MS) return true;
  }
  return /per[- ]day/i.test(`${e.message ?? ""} ${e.responseBody ?? ""}`);
}

export const NOT_CONNECTED_REASON = "its owner disconnected OpenRouter";
