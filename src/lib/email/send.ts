/**
 * The email seam: everything the app sends goes through `sendEmail`. Production sends through a
 * dedicated Gmail account (SMTP with an app password); without those settings, emails go to the
 * outbox: printed to the server log (links are clickable there in development) and, when
 * EMAIL_OUTBOX_FILE is set, appended to that file so end-to-end tests can read them.
 * Moving to another provider (e.g. Resend with a domain) means adding a sender here.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import nodemailer from "nodemailer";

export type Email = { to: string; subject: string; text: string; html: string };

export interface EmailSender {
  send(email: Email): Promise<void>;
}

export const APP_NAME = "Agent Arena";

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** The Gmail settings, forgiving the usual paste slips: spaces Google shows in app passwords, stray whitespace. */
export function gmailCredentials(): { user: string; pass: string } {
  return {
    user: (process.env.GMAIL_USER ?? "").trim(),
    pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
  };
}

export function gmailTransport(user: string, pass: string) {
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

export function gmailSender({ user, pass } = gmailCredentials()): EmailSender {
  const transport = gmailTransport(user, pass);
  return {
    async send(email) {
      await transport.sendMail({ from: `"${APP_NAME}" <${user}>`, ...email });
    },
  };
}

/** Development and tests: no real email; the message is logged (and written to a file if asked). */
export function outboxSender(file = process.env.EMAIL_OUTBOX_FILE): EmailSender {
  return {
    async send(email) {
      console.log(`[email] to ${email.to}: ${email.subject}\n${email.text}`);
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, JSON.stringify({ ...email, sentAt: Date.now() }) + "\n");
      }
    },
  };
}

let sender: EmailSender | undefined;

function getSender(): EmailSender {
  if (sender) return sender;
  if (gmailConfigured()) sender = gmailSender();
  else if (process.env.VERCEL_ENV === "production") {
    // Never pretend to send in production: sign-up would wait for a confirmation that never comes.
    throw new Error("Email isn't configured: set GMAIL_USER and GMAIL_APP_PASSWORD.");
  } else sender = outboxSender();
  return sender;
}

export async function sendEmail(email: Email): Promise<void> {
  await getSender().send(email);
}
