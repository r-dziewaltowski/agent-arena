"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getCurrentUser, requireAdmin } from "@/lib/auth/session";
import {
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_MESSAGE_MIN_LENGTH,
  CONTACT_TOPICS,
  ContactError,
  createMessage,
  deleteMessage,
  hashIp,
  HONEYPOT_FIELD,
  markMessageDone,
  type ContactTopic,
} from "@/lib/contact";
import { getDb } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { contactReceived } from "@/lib/email/templates";

export type ContactFormState = {
  sent?: boolean;
  replyTo?: string;
  message?: string;
  errors?: Partial<Record<"topic" | "body" | "replyTo", string[]>>;
  /** What was typed, so a refused form keeps it. */
  values?: { topic: string; body: string; replyTo: string };
};

const contactSchema = z.object({
  topic: z.enum(Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]], { error: "Pick what it's about." }),
  body: z
    .string()
    .trim()
    .min(CONTACT_MESSAGE_MIN_LENGTH, "Please say a little more.")
    .max(CONTACT_MESSAGE_MAX_LENGTH, `Keep it under ${CONTACT_MESSAGE_MAX_LENGTH} characters.`),
  replyTo: z.email("Enter an email address we can reply to.").max(254),
});

/** Sends a Contact page message to the admins: saved, then emailed with Reply-To set to the sender. */
export async function contactAction(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const values = {
    topic: String(formData.get("topic") ?? ""),
    body: String(formData.get("body") ?? ""),
    replyTo: String(formData.get("replyTo") ?? "").trim(),
  };
  // A bot filled in the hidden field: pretend it worked, so it doesn't learn to skip it.
  if (String(formData.get(HONEYPOT_FIELD) ?? "") !== "") return { sent: true, replyTo: values.replyTo };

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, values };
  const { topic, body, replyTo } = parsed.data;

  const me = await getCurrentUser();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const now = Date.now();
  const db = await getDb();
  try {
    await createMessage(
      db,
      { topic, body, replyTo, userId: me?.id ?? null, ipHash: hashIp(ip, now, process.env.BETTER_AUTH_SECRET ?? "agent-arena") },
      now,
    );
  } catch (err) {
    if (err instanceof ContactError) return { message: err.message, values };
    throw err;
  }

  // A failed email is logged, never shown: the message is saved and listed on the admin page.
  try {
    const admins = await db
      .select({ email: user.email })
      .from(user)
      .where(and(eq(user.isAdmin, true), isNull(user.deletedAt)));
    const origin = h.get("origin") ?? `https://${h.get("host")}`;
    for (const admin of admins) {
      await sendEmail(
        contactReceived(admin.email, { topic: CONTACT_TOPICS[topic], body, replyTo, senderName: me?.displayName ?? null }, `${origin}/admin#messages`),
      );
    }
  } catch (err) {
    console.error("[contact] couldn't email the admins", err);
  }
  return { sent: true, replyTo };
}

export async function markMessageDoneAction(formData: FormData) {
  const me = await requireAdmin();
  await markMessageDone(await getDb(), String(formData.get("messageId") ?? ""), me.id, Date.now());
  refresh();
}

export async function deleteMessageAction(formData: FormData) {
  await requireAdmin();
  await deleteMessage(await getDb(), String(formData.get("messageId") ?? ""));
  refresh();
}
