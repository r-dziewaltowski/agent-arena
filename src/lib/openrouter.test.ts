import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedUser } from "../test/helpers";
import type { Db } from "./db/client";
import { providerConnections } from "./db/schema";
import {
  authorizeUrl,
  createPkce,
  deleteConnection,
  exchangeCode,
  getConnection,
  keyRefusalReason,
  loadKey,
  markKeyFailed,
  openPkceCookie,
  saveConnection,
  sealPkceCookie,
} from "./openrouter";

let db: Db;
let cleanup: () => void;
beforeEach(async () => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", randomBytes(32).toString("base64"));
  ({ db, cleanup } = await createTestDb());
  await seedUser(db, "alice");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("PKCE", () => {
  it("builds a S256 challenge from the verifier and puts it in the authorize URL", () => {
    const { verifier, challenge, state } = createPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(authorizeUrl({ callbackUrl: "https://arena.example/api/openrouter/callback", challenge, state }));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ code_challenge: challenge, code_challenge_method: "S256", state });
  });

  it("only opens its cookie for the same user and state, before it expires", () => {
    const sealed = sealPkceCookie({ verifier: "v", state: "s", userId: "alice" }, 1_000);
    expect(openPkceCookie(sealed, { state: "s", userId: "alice" }, 2_000)).toBe("v");
    expect(openPkceCookie(sealed, { state: "other", userId: "alice" }, 2_000)).toBeNull();
    expect(openPkceCookie(sealed, { state: "s", userId: "bob" }, 2_000)).toBeNull();
    expect(openPkceCookie(sealed, { state: "s", userId: "alice" }, 1_000 + 11 * 60_000)).toBeNull();
    expect(openPkceCookie("garbage", { state: "s", userId: "alice" })).toBeNull();
  });

  it("swaps the code for the key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ key: "sk-or-v1-test" }));
    expect(await exchangeCode("code", "verifier", fetchMock)).toBe("sk-or-v1-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ code: "code", code_verifier: "verifier", code_challenge_method: "S256" });
    await expect(exchangeCode("code", "v", async () => new Response("no", { status: 403 }))).rejects.toThrow("403");
  });
});

describe("connections", () => {
  it("stores the key encrypted, replaces it on reconnect, and deletes it", async () => {
    await saveConnection(db, "alice", "sk-or-v1-first", 1);
    const [row] = await db.select().from(providerConnections);
    expect(row.encryptedKey).not.toContain("sk-or");
    expect(await loadKey(db, "alice")).toBe("sk-or-v1-first");

    await markKeyFailed(db, "alice", "out of credit", 2);
    expect(await getConnection(db, "alice")).toMatchObject({ failReason: "out of credit" });
    await saveConnection(db, "alice", "sk-or-v1-second", 3);
    expect(await loadKey(db, "alice")).toBe("sk-or-v1-second");
    expect(await getConnection(db, "alice")).toMatchObject({ connectedAt: 3, failReason: null });

    await deleteConnection(db, "alice");
    expect(await loadKey(db, "alice")).toBeNull();
    expect(await getConnection(db, "alice")).toBeNull();
  });
});

describe("keyRefusalReason", () => {
  it("recognises refused keys, and nothing else", () => {
    expect(keyRefusalReason({ statusCode: 402 })).toMatch(/out of credit/);
    expect(keyRefusalReason(Object.assign(new Error("x"), { cause: { statusCode: 401 } }))).toMatch(/revoked/);
    expect(keyRefusalReason({ statusCode: 429 })).toBeNull(); // a busy host or the per-minute limit
    // The daily free limit: it lifts hours away (epoch ms or seconds), or says so.
    const now = 1_700_000_000_000;
    expect(keyRefusalReason({ statusCode: 429, responseHeaders: { "x-ratelimit-reset": String(now + 5 * 3_600_000) } }, now)).toMatch(/today's free requests/);
    expect(keyRefusalReason({ statusCode: 429, responseHeaders: { "x-ratelimit-reset": String((now + 5 * 3_600_000) / 1000) } }, now)).toMatch(/today's free requests/);
    expect(keyRefusalReason({ statusCode: 429, responseHeaders: { "x-ratelimit-reset": String(now + 40_000) } }, now)).toBeNull();
    expect(keyRefusalReason({ statusCode: 429, message: "Rate limit exceeded: free-models-per-day" }, now)).toMatch(/today's free requests/);
    expect(keyRefusalReason(new Error("boom"))).toBeNull();
  });
});
