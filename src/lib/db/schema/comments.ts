import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { debates } from "./debates";

/**
 * Chat beside a live debate: what signed-in viewers say while it plays. The agents never see it.
 * A deleted comment keeps its row (text cleared, `deletedAt` set) so viewers' next poll learns
 * it's gone; one removed by an admin shows as removed. Deleted with the debate, and with the
 * author's account.
 */
export const debateComments = sqliteTable(
  "debate_comments",
  {
    id: text("id").primaryKey(),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
    /** Who deleted it: its author (it disappears) or an admin (it shows as removed). */
    deletedBy: text("deleted_by", { enum: ["author", "admin"] }),
  },
  (t) => [
    index("debate_comments_debate_created_idx").on(t.debateId, t.createdAt),
    index("debate_comments_debate_deleted_idx").on(t.debateId, t.deletedAt),
    index("debate_comments_user_debate_idx").on(t.userId, t.debateId, t.createdAt),
  ],
);
