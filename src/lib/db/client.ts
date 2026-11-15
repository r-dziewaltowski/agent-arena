import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "file:./data/arena.db";

type Opened = { db: Db; client: Client; ready: Promise<void> };

/**
 * Creates a database handle synchronously (Better Auth needs one at import time). For local
 * files it creates the folder, then queues the PRAGMAs: WAL so the web app and the worker can
 * read while the other writes, a busy timeout so concurrent writes wait instead of failing, and
 * foreign keys. One connection per client keeps those PRAGMAs in effect, and because that one
 * connection runs statements in order, they always run before any later query.
 */
export function createDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Opened {
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
