import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./env";
import { emailCount, linkFromEmail } from "./outbox";

/**
 * The account lifecycle through a real browser: confirming an email, resetting a forgotten
 * password, changing your name and password, deleting the account, and the privacy page. Emails
 * are read from the outbox file the app writes during the tests (see e2e/env.ts).
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const field = (name: string) => `[name="${name}"]`;

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.locator(field("displayName")).fill(name);
  await page.locator(field("email")).fill(email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.locator(field("email")).fill(email);
  await page.locator(field("password")).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

const headerName = (page: Page, name: string) => page.getByRole("banner").getByRole("link", { name, exact: true });

test("an unconfirmed account can't sign in until the email is confirmed", async ({ page }) => {
  const email = `carol-${run}@example.test`;
  await signUp(page, "Carol E2E", email);

  const before = emailCount(email);
  await signIn(page, email, PASSWORD);
  await expect(page.getByText("Please confirm your email first.")).toBeVisible();

  // Signing in sent a fresh link; it signs her in.
  await page.goto(await linkFromEmail(email, "Confirm your email", before));
  await expect(page.getByRole("heading", { name: "You're in, Carol E2E" })).toBeVisible();
  await expect(headerName(page, "Carol E2E")).toBeVisible();
});

test("signing up again with a taken email doesn't reveal the account, but tells its owner", async ({ page }) => {
  const email = `carol-${run}@example.test`;
  const before = emailCount(email);
  await signUp(page, "Someone Else", email);
  await linkFromEmail(email, "You already have", before);
});

test("a forgotten password can be reset from the emailed link", async ({ page }) => {
  const email = `dave-${run}@example.test`;
  await signUp(page, "Dave E2E", email);
  await page.goto(await linkFromEmail(email, "Confirm your email"));
  await expect(page.getByRole("heading", { name: "You're in, Dave E2E" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  // Next keeps the sign-in page mounted but hidden, with its own email field.
  await page.locator(field("email")).filter({ visible: true }).fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto(await linkFromEmail(email, "Reset your"));
  await page.locator(field("password")).fill("a-brand-new-password");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("Your password was changed. Sign in with the new one.")).toBeVisible();

  await signIn(page, email, PASSWORD);
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await signIn(page, email, "a-brand-new-password");
  await expect(headerName(page, "Dave E2E")).toBeVisible();
});

test("the account page changes your name and password, and deletes the account", async ({ page, browser }) => {
  const email = `erin-${run}@example.test`;
  await signUp(page, "Erin E2E", email);
  await page.goto(await linkFromEmail(email, "Confirm your email"));
  await headerName(page, "Erin E2E").click();
  await expect(page).toHaveURL(/\/account$/);

  await page.locator(field("displayName")).fill("Erin Renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Display name saved.")).toBeVisible();
  await expect(headerName(page, "Erin Renamed")).toBeVisible();

  // Also signed in on another device, which a password change signs out.
  const other = await (await browser.newContext()).newPage();
  await signIn(other, email, PASSWORD);
  await expect(headerName(other, "Erin Renamed")).toBeVisible();

  await page.locator(field("currentPassword")).fill("not-my-password");
  await page.locator(field("newPassword")).fill("another-password-1");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("That isn't your current password.")).toBeVisible();
  await page.locator(field("currentPassword")).fill(PASSWORD);
  await page.locator(field("newPassword")).fill("another-password-1");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();
  await expect(headerName(page, "Erin Renamed")).toBeVisible(); // this browser stays signed in
  await other.reload();
  await expect(other.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await other.context().close();

  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
  await expect(page.getByText("Your account was deleted.")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

  await signIn(page, email, "another-password-1");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("a stale sign-in cookie doesn't show the new agent or new debate forms", async ({ page, context }) => {
  // The proxy lets any session cookie through; the pages themselves must check it's still valid.
  await context.addCookies([{ name: "better-auth.session_token", value: "expired-or-revoked", url: E2E_BASE_URL }]);
  for (const path of ["/agents/new", "/debates/new"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}$`));
  }
});

test("the account page needs you signed in, and the privacy page is linked from every page", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);

  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we store" })).toBeVisible();
});
