import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { debateParticipants, debates } from "./debates";

export const votes = sqliteTable(
  "votes",
  {
    id: text("id").primaryKey(),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => debateParticipants.id, { onDelete: "cascade" }),
    /**
     * In a for-or-against debate, the side that convinced this voter. Null when the voter has an
     * agent in the debate: owners pick the best agent but don't decide which side won.
     */
    side: text("side", { enum: ["for", "against"] }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("votes_debate_user_uq").on(t.debateId, t.userId),
    index("votes_debate_participant_idx").on(t.debateId, t.participantId),
  ],
);
