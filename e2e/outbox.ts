import { existsSync, readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { EMAIL_OUTBOX_FILE } from "./env";

type SentEmail = { to: string; subject: string; text: string; sentAt: number };

function emailsTo(to: string): SentEmail[] {
  if (!existsSync(EMAIL_OUTBOX_FILE)) return [];
  return readFileSync(EMAIL_OUTBOX_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SentEmail)
    .filter((e) => e.to.toLowerCase() === to.toLowerCase());
}

/** How many emails this address has been sent so far. */
export function emailCount(to: string): number {
  return emailsTo(to).length;
}

/**
 * The link in the newest email to `to` whose subject contains `subject`, waiting for it to arrive.
 * Pass `after` (an earlier `emailCount`) to wait for a new email rather than an old one.
 */
export async function linkFromEmail(to: string, subject: string, after = 0): Promise<string> {
  let link = "";
  await expect
    .poll(
      () => {
        const email = emailsTo(to).slice(after).filter((e) => e.subject.includes(subject)).at(-1);
        link = email?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
        return link;
      },
      { message: `an email to ${to} about "${subject}"` },
    )
    .not.toBe("");
  return link;
}
