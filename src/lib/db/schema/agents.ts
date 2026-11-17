import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    persona: text("persona").notNull(),
    /** A preset key from traits.ts or the owner's own text. */
    style: text("style").notNull(),
    /** A preset key from traits.ts or the owner's own text. */
    tone: text("tone").notNull(),
    /** A stance preset key from traits.ts. Plain text so custom values can be added later. */
    stance: text("stance").notNull(),
    provider: text("provider", { enum: ["ollama", "groq", "google", "openrouter", "anthropic"] }).notNull(),
    modelId: text("model_id").notNull(),
    creativity: text("creativity", { enum: ["focused", "balanced", "creative", "wild"] })
      .notNull()
      .default("balanced"),
    turnLength: text("turn_length", { enum: ["short", "medium", "long"] })
      .notNull()
      .default("medium"),
    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    /** A voice from `voice/voices.ts`; null for agents saved before voices (one is picked from the id). */
    voice: text("voice"),
    /** How it speaks, in the owner's words; empty follows the agent's tone. */
    voiceStyle: text("voice_style"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("agents_owner_idx").on(t.ownerId),
    // A user's agents have distinct names, ignoring case. Different users may share a name; a
    // debate tells same-named agents apart by suffixing later ones ("Ada (2)").
    uniqueIndex("agents_owner_name_unique").on(t.ownerId, sql`lower(${t.name})`),
  ],
);
