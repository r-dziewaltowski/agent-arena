import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:./data/arena.db";

type Opened = { db: Db; client: Client; ready: Promise<void> };

type FetchWithOriginal = typeof fetch & { _nextOriginalFetch?: typeof fetch };

/**
 * A remote database (Turso) is queried over HTTP with `fetch`. Next.js replaces the global fetch
 * with one that tracks requests made while it prerenders a page (e.g. a prefetch rendered with
 * the visitor's cookies) and rejects those still running when that prerender ends. The client is
 * shared by every request and sends queued queries together, so one prerender's rejected fetch
 * failed other requests' queries too (HANGING_PROMISE_REJECTION on every signed-in page). Database
 * calls aren't part of Next's data cache, so they go through the original, untracked fetch.
 *
 * It also retries once when the connection was closed before any reply. Turso closes idle
 * connections, and Vercel freezes the function between requests, so a warm function can send its
 * next query down a connection that is already gone ("other side closed"), failing the whole page.
 * Turso never received that query, so sending it again on a fresh connection is safe.
 */
export async function untrackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const current = globalThis.fetch as FetchWithOriginal;
  const send = current._nextOriginalFetch ?? current;
  const spare = input instanceof Request ? input.clone() : input; // a request body can be read only once
  try {
    return await send(input, init);
  } catch (err) {
    if (!closedBeforeReply(err)) throw err;
    return send(spare, init);
  }
}

/**
 * A dead keep-alive connection: closed by the server before it answered, or a write that never
 * got through (seen in production: "other side closed" and "write ETIMEDOUT" on the same socket).
 */
export function closedBeforeReply(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; syscall?: string } } | null)?.cause;
  if (!(err instanceof TypeError) || !cause) return false;
  if (["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"].includes(cause.code ?? "")) return true;
  return cause.code === "ETIMEDOUT" && cause.syscall === "write";
}

/**
 * Creates a database handle synchronously (Better Auth needs one at import time). For local
 * files it creates the folder, then queues the PRAGMAs: WAL so the web app and the worker can
 * read while the other writes, a busy timeout so concurrent writes wait instead of failing, and
 * foreign keys. One connection per client keeps those PRAGMAs in effect, and because that one
 * connection runs statements in order, they always run before any later query.
 */
export function createDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Opened {
  // On Vercel the file system is read-only and temporary: a missing DATABASE_URL must fail loudly.
  if (process.env.VERCEL && !process.env.DATABASE_URL && url === DEFAULT_DATABASE_URL) {
    throw new Error("DATABASE_URL isn't set. On Vercel it must point to the Turso database.");
  }
  const isFile = url.startsWith("file:");
  if (isFile) {
    const path = url.slice("file:".length);
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
    concurrency: 1,
    timeout: 5000,
    ...(isFile ? {} : { fetch: untrackedFetch }),
  });

  const pragmas = ["PRAGMA foreign_keys = ON"];
  if (isFile) {
    pragmas.push("PRAGMA journal_mode = WAL", "PRAGMA synchronous = NORMAL", "PRAGMA busy_timeout = 5000");
  }
  const ready = pragmas.reduce<Promise<unknown>>((p, sql) => p.then(() => client.execute(sql)), Promise.resolve()).then(
    () => undefined,
  );

  return { db: drizzle(client, { schema }), client, ready };
}

/** Opens a database and waits until its PRAGMAs have run (scripts and tests). */
export async function openDb(url?: string): Promise<{ db: Db; client: Client }> {
  const { db, client, ready } = createDb(url);
  await ready;
  return { db, client };
}

const globalForDb = globalThis as unknown as { __arenaDb?: Opened };

/**
 * The app-wide database. Cached on globalThis so Next.js hot reloads in development don't open
 * a new connection on every change.
 */
export function getDbSync(): Db {
  globalForDb.__arenaDb ??= createDb();
  return globalForDb.__arenaDb.db;
}

export async function getDb(): Promise<Db> {
  const db = getDbSync();
  await globalForDb.__arenaDb!.ready;
  return db;
}
