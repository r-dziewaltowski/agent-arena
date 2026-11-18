/**
 * Contact messages: anyone, signed in or not, can write to the admins privately (GitHub issues are
 * public and need an account). Spam is kept down without a CAPTCHA: a honeypot field (checked in
 * the action), a few messages a day per reply address, account and IP address, and a length limit.
 */
import { createHmac, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, lt, or, type SQL } from "drizzle-orm";
import type { Db } from "./db/client";
import { contactMessages } from "./db/schema";
import { CONTACT_MESSAGE_MAX_LENGTH, type ContactTopic } from "./contact-shared";

export { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_MESSAGE_MIN_LENGTH, CONTACT_TOPICS, HONEYPOT_FIELD, type ContactTopic } from "./contact-shared";

/** Messages one person (reply address, account or IP address) may send in a day. */
export const MESSAGES_PER_DAY = 3;
/** Messages are deleted this long after they were sent, done or not. */
export const MESSAGES_KEPT_MS = 183 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export class ContactError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * A keyed hash of an IP address and the UTC day: enough to count one visitor's messages today,
 * without storing the address or being able to link the same visitor across days.
 */
export function hashIp(ip: string, now: number, secret: string): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return createHmac("sha256", secret).update(`${day}|${ip}`).digest("base64url");
}

export type NewMessage = {
  topic: ContactTopic;
  body: string;
  replyTo: string;
  userId: string | null;
  ipHash: string;
};

/** Saves a message after checking the daily limits. Returns its id. */
export async function createMessage(db: Db, input: NewMessage, now: number): Promise<string> {
  const replyTo = input.replyTo.trim().toLowerCase();
  const sameSender: SQL[] = [eq(contactMessages.replyTo, replyTo), eq(contactMessages.ipHash, input.ipHash)];
  if (input.userId) sameSender.push(eq(contactMessages.userId, input.userId));
  const [{ sent }] = await db
    .select({ sent: count() })
    .from(contactMessages)
    .where(and(gt(contactMessages.createdAt, now - DAY_MS), or(...sameSender)));
  if (sent >= MESSAGES_PER_DAY) {
    throw new ContactError("You've sent a few messages today already. We'll reply to those; please try again tomorrow if you need to.");
  }

  const id = randomUUID();
  await db.insert(contactMessages).values({
    id,
    topic: input.topic,
    body: input.body.trim().slice(0, CONTACT_MESSAGE_MAX_LENGTH),
    replyTo,
    userId: input.userId,
    ipHash: input.ipHash,
    createdAt: now,
  });
  return id;
}

export async function openMessageCount(db: Db): Promise<number> {
  const [{ open }] = await db.select({ open: count() }).from(contactMessages).where(eq(contactMessages.status, "open"));
  return open;
}

/** An admin answered it (or there's nothing to answer). */
export async function markMessageDone(db: Db, messageId: string, adminId: string, now: number): Promise<void> {
  await db
    .update(contactMessages)
    .set({ status: "done", doneById: adminId, doneAt: now })
    .where(and(eq(contactMessages.id, messageId), eq(contactMessages.status, "open")));
}

/** Spam, or the sender asked for it to go. */
export async function deleteMessage(db: Db, messageId: string): Promise<void> {
  await db.delete(contactMessages).where(eq(contactMessages.id, messageId));
}

/** Run by the sweep: messages older than six months go, answered or not. */
export async function deleteOldMessages(db: Db, now: number): Promise<void> {
  await db.delete(contactMessages).where(lt(contactMessages.createdAt, now - MESSAGES_KEPT_MS));
}

export type MessageView = {
  id: string;
  topic: ContactTopic;
  body: string;
  replyTo: string;
  userId: string | null;
  status: "open" | "done";
  createdAt: number;
  doneAt: number | null;
};

/** Open messages, oldest first (the order to answer them), and the most recently done ones. */
export async function loadMessages(db: Db): Promise<{ open: MessageView[]; done: MessageView[] }> {
  const columns = {
    id: contactMessages.id,
    topic: contactMessages.topic,
    body: contactMessages.body,
    replyTo: contactMessages.replyTo,
    userId: contactMessages.userId,
    status: contactMessages.status,
    createdAt: contactMessages.createdAt,
    doneAt: contactMessages.doneAt,
  };
  const open = await db.select(columns).from(contactMessages).where(eq(contactMessages.status, "open")).orderBy(contactMessages.createdAt);
  const done = await db.select(columns).from(contactMessages).where(eq(contactMessages.status, "done")).orderBy(desc(contactMessages.doneAt)).limit(20);
  return { open, done };
}
