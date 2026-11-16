import { expect, test, type Browser, type Page } from "@playwright/test";
import { linkFromEmail } from "./outbox";

/**
 * Paid models through the browser, with a fake OpenRouter (scripts/e2e-server.ts) and the fake
 * model: connecting, a paid agent debating with its cost shown, and an agent whose owner
 * disconnected being skipped while the debate carries on.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const field = (name: string) => `[name="${name}"]`;
const carol = { name: "Carol Paid", email: `carol-paid-${run}@example.test` };
const dan = { name: "Dan Free", email: `dan-free-${run}@example.test` };
let carolPage: Page;
let danPage: Page;
let waitingDebate = "";

async function signedUp(browser: Browser, user: { name: string; email: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-up");
  await page.locator(field("displayName")).fill(user.name);
  await page.locator(field("email")).fill(user.email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await linkFromEmail(user.email, "Confirm your email"));
  await expect(page.getByRole("heading", { name: `You're in, ${user.name}` })).toBeVisible();
  return page;
}

async function createAgent(page: Page, name: string, model?: string) {
  await page.goto("/agents/new");
  await page.locator(field("name")).fill(name);
  if (model) await page.locator(field("model")).selectOption({ label: model });
  await page.locator(field("persona")).fill("A city planner who argues from what has worked in real cities.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents$/);
}

async function newDebate(page: Page, topic: string): Promise<string> {
  await page.goto("/debates/new");
  await page.locator(field("topic")).fill(topic);
  await page.locator(field("rounds")).selectOption("2");
  await page.getByLabel("When all slots are filled").check();
  await page.getByRole("button", { name: "Create debate" }).click();
  await expect(page).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  return page.url();
}

async function enterAgent(page: Page, debateUrl: string, agent: string) {
  await page.goto(debateUrl);
  await page.locator(field("agentId")).first().selectOption({ label: agent });
  await page.getByRole("button", { name: "Enter here" }).first().click();
}

test("paid models are offered only after connecting OpenRouter", async ({ browser }) => {
  carolPage = await signedUp(browser, carol);
  await carolPage.goto("/agents/new");
  await expect(carolPage.getByText("Connect your OpenRouter account on")).toBeVisible();
  await expect(carolPage.locator(`${field("model")} option`, { hasText: "Claude Haiku 5.5" })).toHaveCount(0);

  await carolPage.goto("/account");
  await carolPage.getByRole("button", { name: "Connect OpenRouter" }).click();
  // The fake OpenRouter approves at once and sends Carol back.
  await expect(carolPage).toHaveURL(/\/account\?openrouter=connected$/);
  await expect(carolPage.getByText("OpenRouter is connected.")).toBeVisible();
  await expect(carolPage.getByRole("link", { name: "Manage this key on OpenRouter" })).toBeVisible();

  await carolPage.goto("/agents/new");
  // OpenRouter's free models in a group of their own, the paid ones with their rough cost per turn.
  await expect(carolPage.locator('optgroup[label="Free, on your OpenRouter account (your own daily limit)"] option')).toHaveText([
    "Nemotron 3 Ultra",
    "Nemotron 3.5 Super",
  ]);
  await carolPage.locator(field("model")).selectOption({ label: "Claude Haiku 5.5" });
  await expect(carolPage.getByText(/About \$0\.000\d+ a turn\./)).toBeVisible();
});

test("a paid agent debates on its owner's account, and its cost is shown", async ({ browser }) => {
  await createAgent(carolPage, "Paid Pat", "Claude Haiku 5.5");
  danPage = await signedUp(browser, dan);
  await createAgent(danPage, "Free Fred");

  const debate = await newDebate(carolPage, "Should parks stay open all night?");
  await enterAgent(carolPage, debate, "Paid Pat");
  await expect(carolPage.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await enterAgent(danPage, debate, "Free Fred"); // fills it: it starts

  await expect(danPage.getByText("Finished", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(danPage.getByText(/^Scripted argument \d+\./)).toHaveCount(4);
  await expect(danPage.getByText(/Paid Pat \$0\.\d+ on its owner's OpenRouter account; the rest free/)).toBeVisible();
  await expect(danPage.getByText("Paid model, billed to its owner's OpenRouter account.")).toBeVisible();

  // A second debate Carol enters now, while still connected; it starts later.
  waitingDebate = await newDebate(carolPage, "Should buses be free?");
  await enterAgent(carolPage, waitingDebate, "Paid Pat");
  await expect(carolPage.getByRole("button", { name: "Withdraw" })).toBeVisible();
});

test("after disconnecting, the paid agent is skipped and the debate carries on", async () => {
  await carolPage.goto("/account");
  await carolPage.getByRole("button", { name: "Disconnect OpenRouter" }).click();
  await carolPage.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(carolPage.getByText("OpenRouter is disconnected")).toBeVisible();
  await expect(carolPage.getByRole("button", { name: "Connect OpenRouter" })).toBeVisible();

  await enterAgent(danPage, waitingDebate, "Free Fred"); // starts the debate
  await expect(danPage.getByText("Finished", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(danPage.getByText(/^Scripted argument \d+\./)).toHaveCount(2); // only Fred spoke
  await expect(danPage.getByText("Paid Pat can't speak any more: its owner disconnected OpenRouter.")).toBeVisible();

  // And a paid agent can't enter a new debate until its owner connects again.
  const another = await newDebate(carolPage, "Should cities plant more trees?");
  await enterAgent(carolPage, another, "Paid Pat");
  await expect(carolPage.getByText("Connect your OpenRouter account on your account page first.")).toBeVisible();
});
