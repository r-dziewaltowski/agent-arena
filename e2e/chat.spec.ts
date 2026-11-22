import { expect, test, type Browser, type Page } from "@playwright/test";
import { linkFromEmail } from "./outbox";

/**
 * The chat beside a live debate: two people talk while it plays, each comment marked with who has
 * a stake in it; a visitor reads along but must sign in to post; once the debate is over the chat
 * stays on the page, read-only.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const field = (name: string) => `[name="${name}"]`;

async function signedUp(browser: Browser, name: string): Promise<Page> {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${run}@example.test`;
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator(field("displayName")).fill(name);
  await page.locator(field("email")).fill(email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await linkFromEmail(email, "Confirm your email"));
  await expect(page.getByRole("heading", { name: `You're in, ${name}` })).toBeVisible();
  return page;
}

async function createAgent(page: Page, name: string) {
  await page.goto("/agents/new");
  await page.locator(field("name")).fill(name);
  await page.locator(field("persona")).fill("A transport economist who argues from what has worked in real cities.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents$/);
}

const chat = (page: Page) => page.getByRole("list", { name: "Chat comments" });

test("viewers chat while the debate plays, and the chat stays afterwards", async ({ browser }) => {
  const ivy = await signedUp(browser, "Ivy Chat");
  const jon = await signedUp(browser, "Jon Chat");
  await createAgent(ivy, "Ivy's Agent");
  await createAgent(jon, "Jon's Agent");

  await ivy.goto("/debates/new");
  await ivy.locator(field("topic")).fill("Congestion charges");
  await ivy.locator(field("rounds")).selectOption("4");
  await ivy.getByLabel("When all slots are filled").check();
  await ivy.getByRole("button", { name: "Create debate" }).click();
  await expect(ivy).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  const debateUrl = ivy.url();
  // No chat in the lobby.
  await expect(ivy.getByRole("heading", { name: "Chat" })).toHaveCount(0);
  await ivy.getByRole("button", { name: "Enter here" }).first().click();
  await expect(ivy.getByRole("button", { name: "Withdraw" })).toBeVisible();

  await jon.goto(debateUrl);
  await jon.getByRole("button", { name: "Enter here" }).click(); // fills it: it starts
  await expect(jon.getByRole("heading", { name: "Chat" })).toBeVisible();
  await expect(jon.getByText("The agents don't see it.")).toBeVisible();

  // A visitor reads along but has to sign in to post.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(debateUrl);
  await expect(visitor.getByText("to chat.")).toBeVisible();
  await expect(visitor.getByLabel("Your comment")).toHaveCount(0);

  await ivy.goto(debateUrl);
  await ivy.getByLabel("Your comment").fill("Opening strong!");
  await ivy.getByRole("button", { name: "Send" }).click();
  await expect(ivy.getByLabel("Your comment")).toHaveValue("");
  await expect(chat(ivy)).toContainText("Opening strong!");

  // The others get it through the debate's poll, marked with who has a stake in it.
  await expect(chat(jon)).toContainText("Opening strong!");
  await expect(chat(jon).getByRole("listitem", { name: "Comment by Ivy Chat" })).toContainText("owner of Ivy's Agent");
  await expect(chat(visitor)).toContainText("Opening strong!");

  await jon.getByLabel("Your comment").fill("We'll see about that");
  await jon.getByRole("button", { name: "Send" }).click();
  await expect(chat(ivy)).toContainText("We'll see about that");

  // Too soon for another one.
  await jon.getByLabel("Your comment").fill("And another thing");
  await jon.getByRole("button", { name: "Send" }).click();
  await expect(jon.getByText(/Wait \d+ seconds? before your next comment/)).toBeVisible();

  // Over: the chat box goes, the comments stay, read-only.
  await expect(ivy.getByText("Finished", { exact: true })).toBeVisible({ timeout: 80_000 });
  await expect(ivy.getByLabel("Your comment")).toHaveCount(0);
  await ivy.getByText("Chat during the debate (2 comments)").click();
  await expect(chat(ivy)).toContainText("Opening strong!");
  await expect(chat(ivy)).toContainText("We'll see about that");

  // A debate whose creator turned the chat off has none, while it plays or after.
  await ivy.goto("/debates/new");
  await ivy.locator(field("topic")).fill("Road pricing, quietly");
  await ivy.locator(field("rounds")).selectOption("2");
  await ivy.getByLabel("When all slots are filled").check();
  await expect(ivy.getByLabel("Chat beside the debate")).toBeChecked(); // on by default
  await ivy.getByLabel("Chat beside the debate").uncheck();
  await ivy.getByRole("button", { name: "Create debate" }).click();
  await expect(ivy).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  await expect(ivy.getByText("No chat", { exact: true })).toBeVisible();
  await ivy.getByRole("button", { name: "Enter here" }).first().click();
  await expect(ivy.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await jon.goto(ivy.url());
  await jon.getByRole("button", { name: "Enter here" }).click(); // fills it: it starts
  await expect(jon.getByText("Opening statements")).toBeVisible({ timeout: 15_000 });
  await expect(jon.getByRole("heading", { name: "Chat" })).toHaveCount(0);
  await expect(jon.getByLabel("Your comment")).toHaveCount(0);
});
