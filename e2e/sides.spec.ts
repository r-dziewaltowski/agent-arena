import { expect, test, type Browser, type Page } from "@playwright/test";
import { linkFromEmail } from "./outbox";

/**
 * For-or-against debates through the browser: entering with a side (the last slot goes to the
 * empty side), For opening and the sides taking turns, and the vote: a viewer says which side
 * convinced them, while an owner only picks the best agent.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const field = (name: string) => `[name="${name}"]`;
const people = {
  fay: { name: "Fay Sides", email: `fay-sides-${run}@example.test` },
  gus: { name: "Gus Sides", email: `gus-sides-${run}@example.test` },
  hal: { name: "Hal Viewer", email: `hal-viewer-${run}@example.test` },
};
let fay: Page;
let gus: Page;
let debateUrl = "";

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

async function createAgent(page: Page, name: string) {
  await page.goto("/agents/new");
  await page.locator(field("name")).fill(name);
  await page.locator(field("persona")).fill("A city planner who argues from what has worked in real cities.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents$/);
}

test("agents take sides when entering, and the last slot goes to the empty side", async ({ browser }) => {
  fay = await signedUp(browser, people.fay);
  gus = await signedUp(browser, people.gus);
  await createAgent(fay, "Fay's Agent");
  await createAgent(gus, "Gus's Agent");

  await fay.goto("/debates/new");
  await fay.locator(field("topic")).fill("Death penalty");
  await fay.getByLabel("For or against").check();
  await fay.locator(field("rounds")).selectOption("2");
  await fay.getByLabel("When all slots are filled").check();
  await fay.locator(field("tallyVisibility")).selectOption("live");
  await fay.getByRole("button", { name: "Create debate" }).click();
  await expect(fay).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  debateUrl = fay.url();
  await expect(fay.getByText("For or against", { exact: true }).first()).toBeVisible();

  // Fay takes slot 2, arguing Against.
  await fay.getByLabel("Side for slot 2").selectOption("against");
  await fay.getByRole("button", { name: "Enter here" }).nth(1).click();
  await expect(fay.getByText("For: 0 · Against: 1")).toBeVisible();

  // The last slot can only argue For.
  await gus.goto(debateUrl);
  await expect(gus.getByLabel("Side for slot 1")).toHaveCount(0);
  await expect(gus.getByText("the last slot goes to the side nobody has taken yet")).toBeVisible();
  await gus.getByRole("button", { name: "Enter here" }).click(); // fills it: it starts
  await expect(gus.getByText("Finished", { exact: true })).toBeVisible({ timeout: 60_000 });

  // For opens and the sides take turns, each turn marked with its side.
  const turns = gus.locator("article");
  await expect(turns).toHaveCount(4);
  await expect(turns.nth(0)).toContainText("Gus's Agent");
  await expect(turns.nth(0)).toContainText("For");
  await expect(turns.nth(1)).toContainText("Fay's Agent");
  await expect(turns.nth(1)).toContainText("Against");
});

test("a viewer says which side convinced them; an owner only picks the best agent", async ({ browser }) => {
  const hal = await signedUp(browser, people.hal);
  await hal.goto(debateUrl);
  await expect(hal.getByRole("heading", { name: "Which side won? Vote now" })).toBeVisible();
  await hal.getByRole("radio", { name: "Against", exact: true }).check();
  await hal.getByRole("radio", { name: /Gus's Agent/ }).check();
  await hal.getByRole("button", { name: "Vote" }).click();
  await expect(hal.getByText("Against leads, 1–0")).toBeVisible();
  await expect(hal.getByText("Best agent: Gus's Agent")).toBeVisible();

  // Fay has an agent in it: no side question, just the best agent (never her own).
  await fay.goto(debateUrl);
  await expect(fay.getByText("so the other viewers decide which side won")).toBeVisible();
  await expect(fay.getByRole("radio", { name: "For", exact: true })).toHaveCount(0);
  await expect(fay.getByRole("radio", { name: /Fay's Agent/ })).toHaveCount(0);
  await fay.getByRole("radio", { name: /Gus's Agent/ }).check();
  await fay.getByRole("button", { name: "Vote" }).click();
  await expect(fay.getByRole("heading", { name: "Thanks for voting" })).toBeVisible();
  await expect(fay.getByText("Against leads, 1–0")).toBeVisible(); // her vote didn't count for a side
});
