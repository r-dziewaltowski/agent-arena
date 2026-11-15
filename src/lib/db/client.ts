import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:./data/arena.db";

/**
 * Opens a database. For local files it creates the folder, enables WAL so the web app and the
 * worker can read while the other writes, and sets a busy timeout so concurrent writes wait
 * instead of failing. One connection per client keeps the per-connection PRAGMAs in effect.
 */
export async function openDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<{
  db: Db;
  client: Client;
}> {
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
  });

  await client.execute("PRAGMA foreign_keys = ON");
  if (isFile) {
    await client.execute("PRAGMA journal_mode = WAL");
    // Safe with WAL (no corruption on crash) and much faster than the default FULL.
    await client.execute("PRAGMA synchronous = NORMAL");
    await client.execute("PRAGMA busy_timeout = 5000");
  }

  return { db: drizzle(client, { schema }), client };
}

type Cached = { promise: Promise<{ db: Db; client: Client }> };
const globalForDb = globalThis as unknown as { __arenaDb?: Cached };

/**
 * The app-wide database. Cached on globalThis so Next.js hot reloads in development
 * don't open a new connection on every change.
 */
export function getDb(): Promise<Db> {
  if (!globalForDb.__arenaDb) {
    globalForDb.__arenaDb = { promise: openDb() };
  }
  return globalForDb.__arenaDb.promise.then((r) => r.db);
}
