import { expect, test, type Browser, type Page } from "@playwright/test";
import { makeAdmin } from "./db";
import { emailCount, latestEmail, linkFromEmail } from "./outbox";

/**
 * The Contact page: a visitor writes to the admins (who get an email they can reply to), a bot
 * filling the hidden field is quietly dropped, and an admin marks the message done.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const field = (name: string) => `[name="${name}"]`;
const admin = { name: "Ada Admin", email: `ada-admin-${run}@example.test` };
const visitorEmail = `visitor-${run}@example.test`;
const body = `Please tell me what you store about me. (${run})`;
let adminPage: Page;

async function signedUp(browser: Browser, person: { name: string; email: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator(field("displayName")).fill(person.name);
  await page.locator(field("email")).fill(person.email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await linkFromEmail(person.email, "Confirm your email"));
  await expect(page.getByRole("heading", { name: `You're in, ${person.name}` })).toBeVisible();
  return page;
}

async function fillMessage(page: Page, text: string, replyTo: string) {
  await page.locator(field("topic")).selectOption("privacy");
  await page.locator(field("body")).fill(text);
  await page.locator(field("replyTo")).fill(replyTo);
}

test("a visitor writes to the admins, who get an email they can reply to", async ({ browser, page }) => {
  adminPage = await signedUp(browser, admin);
  await makeAdmin(admin.email);
  const before = emailCount(admin.email);

  await page.goto("/privacy");
  await page.getByRole("contentinfo").getByRole("link", { name: "Contact" }).click();
  await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
  await expect(page.locator(field("replyTo"))).toHaveValue(""); // a visitor: nothing to prefill
  await fillMessage(page, body, visitorEmail);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks, your message is on its way.")).toBeVisible();
  await expect(page.getByText(visitorEmail)).toBeVisible();

  const email = await latestEmail(admin.email, "Message on Agent Arena", before);
  expect(email.subject).toBe("Message on Agent Arena: Privacy or my data");
  expect(email.replyTo).toBe(visitorEmail);
  expect(email.text).toContain(body);
});

test("a bot that fills in the hidden field is told it worked, but nothing is sent", async ({ page }) => {
  const before = emailCount(admin.email);
  await page.goto("/contact");
  await fillMessage(page, "Cheap pills, visit my site now!", `bot-${run}@example.test`);
  // People never see this field; bots fill in every input they find.
  await page.locator(field("leave_this_empty")).evaluate((input: HTMLInputElement) => (input.value = "https://spam.example"));
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thanks, your message is on its way.")).toBeVisible();

  // The admin page lists only the real message, and no email went out for the bot's.
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { name: "Messages to answer (1)" })).toBeVisible();
  await expect(adminPage.getByText("Cheap pills")).toHaveCount(0);
  expect(emailCount(admin.email)).toBe(before);
});

test("an admin answers by email and marks the message done", async () => {
  await adminPage.goto("/debates");
  await adminPage.getByRole("link", { name: /^admin · \d+ to review$/ }).click();
  await expect(adminPage).toHaveURL(/\/admin$/);
  await expect(adminPage.getByText(body)).toBeVisible();
  await expect(adminPage.getByText(`${visitorEmail}, not signed in`, { exact: false })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Reply by email" })).toHaveAttribute("href", new RegExp(`^mailto:${encodeURIComponent(visitorEmail)}`));

  await adminPage.getByRole("button", { name: "Mark done" }).click();
  await expect(adminPage.getByText("No messages waiting.")).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "Recently answered messages" })).toBeVisible();

  // Signed in, the reply address starts as the account's own.
  await adminPage.goto("/contact");
  await expect(adminPage.locator(field("replyTo"))).toHaveValue(admin.email);
  await expect(adminPage.getByText("Sent as Ada Admin.", { exact: false })).toBeVisible();
});
