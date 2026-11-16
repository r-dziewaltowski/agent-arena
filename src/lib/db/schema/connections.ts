import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * A user's connection to a paid model service (M5: OpenRouter only). The service's API key is
 * kept so debates can run while the owner is offline: encrypted (see `src/lib/secrets.ts`), never
 * shown, logged or sent to the browser, and deleted on disconnect or account deletion.
 */
export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["openrouter"] }).notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    /** SHA-256 of the key, hex: OpenRouter's page for managing it is /keys/<this>. */
    keyHash: text("key_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    /** Set when the service last refused the key (revoked, out of credit, limit reached). */
    failedAt: integer("failed_at"),
    failReason: text("fail_reason"),
  },
  (t) => [uniqueIndex("provider_connections_user_provider_uq").on(t.userId, t.provider)],
);
