import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * A message from the Contact page: privacy requests, account problems and anything else people
 * would rather not post publicly. Visitors can send one too. Emailed to the admins and kept here
 * (admin email can land in spam) until an admin marks it done; deleted after six months, and with
 * the sender's account.
 */
export const contactMessages = sqliteTable(
  "contact_messages",
  {
    id: text("id").primaryKey(),
    topic: text("topic", { enum: ["privacy", "account", "content", "other"] }).notNull(),
    body: text("body").notNull(),
    /** Where to reply; for a signed-in sender, prefilled with their account's address. */
    replyTo: text("reply_to").notNull(),
    /** The sender's account, if they were signed in. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /**
     * A keyed hash of the sender's IP address and the day, for the daily limit only: the address
     * itself isn't stored, and the same visitor can't be linked across days.
     */
    ipHash: text("ip_hash").notNull(),
    status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
    doneById: text("done_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    doneAt: integer("done_at"),
  },
  (t) => [
    index("contact_messages_status_created_idx").on(t.status, t.createdAt),
    index("contact_messages_ip_created_idx").on(t.ipHash, t.createdAt),
    index("contact_messages_reply_created_idx").on(t.replyTo, t.createdAt),
    index("contact_messages_user_idx").on(t.userId),
  ],
);
