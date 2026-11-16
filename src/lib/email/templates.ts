import { APP_NAME, type Email } from "./send";

/** Escapes text for the HTML version of an email. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(paragraphs: string[], link?: { url: string; label: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`).join("");
  const button = link
    ? `<p style="margin:24px 0"><a href="${esc(link.url)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">${esc(link.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">Or paste this link into your browser:<br>${esc(link.url)}</p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:520px">${body}${button}<p style="margin:24px 0 0;font-size:13px;color:#555">${APP_NAME}</p></div>`;
}

export function confirmEmail(to: string, name: string, url: string): Email {
  const lines = [`Hi ${name},`, `Confirm your email address to finish creating your ${APP_NAME} account.`, "The link works for one hour. If you didn't sign up, you can ignore this email."];
  return {
    to,
    subject: `Confirm your email for ${APP_NAME}`,
    text: `${lines.join("\n\n")}\n\nConfirm your email: ${url}`,
    html: layout(lines, { url, label: "Confirm email" }),
  };
}

export function resetPassword(to: string, name: string, url: string): Email {
  const lines = [`Hi ${name},`, `Someone asked to reset the password of your ${APP_NAME} account.`, "The link works for one hour. If it wasn't you, ignore this email; your password stays the same."];
  return {
    to,
    subject: `Reset your ${APP_NAME} password`,
    text: `${lines.join("\n\n")}\n\nChoose a new password: ${url}`,
    html: layout(lines, { url, label: "Choose a new password" }),
  };
}

/** Sent instead of an error when someone signs up with an email that already has an account. */
export function alreadyRegistered(to: string, name: string, siteUrl: string): Email {
  const signIn = `${siteUrl}/sign-in`;
  const reset = `${siteUrl}/forgot-password`;
  const lines = [
    `Hi ${name},`,
    `Someone tried to create a ${APP_NAME} account with this email address, but you already have one.`,
    `If it was you, sign in at ${signIn}, or reset your password at ${reset} if you've forgotten it. If it wasn't you, you can ignore this email.`,
  ];
  return {
    to,
    subject: `You already have a ${APP_NAME} account`,
    text: lines.join("\n\n"),
    html: layout(lines, { url: signIn, label: "Sign in" }),
  };
}
