import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    provider: text("provider", { enum: ["ollama", "anthropic"] }).notNull(),
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("agents_owner_idx").on(t.ownerId)],
);
