/** What the Contact page offers, shared by the form (client) and the server. */
export const CONTACT_TOPICS = {
  privacy: "Privacy or my data",
  account: "A problem with my account",
  content: "Reporting something outside a debate",
  other: "Something else",
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;

export const CONTACT_MESSAGE_MIN_LENGTH = 10;
export const CONTACT_MESSAGE_MAX_LENGTH = 3000;

/**
 * The hidden field only bots fill in (a honeypot). Its name is one browsers don't autofill, so a
 * real person never fills it by accident.
 */
export const HONEYPOT_FIELD = "leave_this_empty";
