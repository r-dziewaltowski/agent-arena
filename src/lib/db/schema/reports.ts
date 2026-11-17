import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { debateParticipants, debates, turns } from "./debates";

/**
 * Someone signed in flagging part of a debate for an admin: its topic, one turn, or one agent (its
 * name or picture). Only admins see reports; they act on them from /admin/reports.
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    target: text("target", { enum: ["topic", "turn", "agent"] }).notNull(),
    /** Set when the target is a turn. */
    turnId: text("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    /** Set when the target is an agent (its entry in this debate, which outlives a deleted agent). */
    participantId: text("participant_id").references(() => debateParticipants.id, { onDelete: "cascade" }),
    /** The turn or participant id, or "" for the topic: what one person may report only once. */
    targetKey: text("target_key").notNull(),
    reason: text("reason", { enum: ["offensive", "sexual", "real_person", "spam", "other"] }).notNull(),
    note: text("note"),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "resolved", "dismissed"] }).notNull().default("open"),
    /** What the admin did, in words ("Removed the turn's text"). */
    resolution: text("resolution"),
    resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_debate_idx").on(t.debateId),
    index("reports_reporter_created_idx").on(t.reporterId, t.createdAt),
    // One report per person for the same thing.
    uniqueIndex("reports_once_per_target").on(t.reporterId, t.debateId, t.target, t.targetKey),
  ],
);
