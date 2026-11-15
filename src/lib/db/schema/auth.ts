import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The `user` table, shaped like Better Auth's core user table so M3 can adopt it.
 * M3 adds Better Auth's `session`, `account` and `verification` tables alongside it.
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Shown wherever a person appears. Email addresses are never shown to other users. */
  displayName: text("display_name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
});
