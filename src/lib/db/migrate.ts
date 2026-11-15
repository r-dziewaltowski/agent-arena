import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client";

export const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");

/** Applies any pending migrations from the `drizzle/` folder. */
export async function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER) {
  await migrate(db, { migrationsFolder });
}
