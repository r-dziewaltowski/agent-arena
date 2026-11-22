import { expect, test, type Browser, type Page } from "@playwright/test";
import { linkFromEmail } from "./outbox";

/**
 * Live updates are pushed (the app's own event stream here; Ably in production): a lobby changes
 * for its viewers the moment someone enters, without reloading every few seconds. With the stream
 * blocked, the page falls back to polling and the debate still plays to the end.
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
  await page.locator(field("persona")).fill("A historian who argues from what happened last time.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents$/);
}

async function newDebate(page: Page, topic: string): Promise<string> {
  await page.goto("/debates/new");
  await page.locator(field("topic")).fill(topic);
  await page.locator(field("rounds")).selectOption("2");
  await page.getByRole("button", { name: "Create debate" }).click();
  await expect(page).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  return page.url();
}

/** Counts the page reloads (server re-renders) a page asks for. */
function countRefreshes(page: Page) {
  const counter = { count: 0 };
  page.on("request", (req) => {
    const headers = req.headers();
    if (headers["rsc"] === "1" && !headers["next-router-prefetch"] && new URL(req.url()).pathname.startsWith("/debates/")) counter.count++;
  });
  return counter;
}

let kim: Page;
let lev: Page;

test("a lobby updates the moment someone enters, without reloading every few seconds", async ({ browser }) => {
  kim = await signedUp(browser, "Kim Live");
  lev = await signedUp(browser, "Lev Live");
  await createAgent(kim, "Kim's Agent");
  await createAgent(lev, "Lev's Agent");
  const debateUrl = await newDebate(kim, "Should museums return looted art?");

  const refreshes = countRefreshes(lev);
  const stream = lev.waitForRequest((req) => req.url().endsWith("/events"));
  await lev.goto(debateUrl);
  await stream;
  // Connecting reloads the lobby once, to catch up; after that, nothing until something happens.
  await lev.waitForTimeout(1_500);
  const before = refreshes.count;
  await lev.waitForTimeout(5_000);
  expect(refreshes.count).toBe(before);

  await kim.getByRole("button", { name: "Enter here" }).first().click();
  await expect(lev.getByText("Kim's Agent", { exact: true })).toBeVisible({ timeout: 2_000 });
});

/** The turns fetches a page makes, with how each answer may be cached. */
function recordTurnsFetches(page: Page) {
  const fetches: { url: URL; cacheControl: string }[] = [];
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (/\/api\/debates\/[^/]+\/turns$/.test(url.pathname)) fetches.push({ url, cacheControl: res.headers()["cache-control"] ?? "" });
  });
  return fetches;
}

test("with the stream blocked, the page polls and the debate still plays to the end; pushed pages share answers", async () => {
  const debateUrl = kim.url();
  await lev.route("**/api/debates/*/events", (route) => route.abort());
  await lev.goto(debateUrl);
  await lev.getByRole("button", { name: "Enter here" }).click();
  const kimFetches = recordTurnsFetches(kim);
  const levFetches = recordTurnsFetches(lev);
  // Lev's page can't open the stream: its lobby reloads every few seconds, its transcript polls.
  await kim.getByRole("button", { name: "Start debate" }).click();
  await expect(lev.getByText("Opening statements")).toBeVisible({ timeout: 15_000 });
  await expect(lev.getByText("Finished", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(kim.getByText("Finished", { exact: true })).toBeVisible({ timeout: 10_000 });

  // Polling always asks for comments too, and is never cached.
  expect(levFetches.length).toBeGreaterThan(0);
  for (const f of levFetches) {
    expect(f.url.searchParams.has("commentsSince")).toBe(true);
    expect(f.url.searchParams.has("v")).toBe(false);
    expect(f.cacheControl).toBe("no-store");
  }
  // Pushed: the catch-up asks for comments (personal); fetches on events and at turn starts and
  // ends carry a version and no comments, so the CDN may share them.
  expect(kimFetches.some((f) => f.url.searchParams.has("commentsSince") && f.cacheControl === "no-store")).toBe(true);
  const shared = kimFetches.filter((f) => f.url.searchParams.has("v"));
  expect(shared.length).toBeGreaterThan(0);
  for (const f of shared) {
    expect(f.url.searchParams.has("commentsSince")).toBe(false);
    expect(f.cacheControl).toBe("public, max-age=0, s-maxage=2");
  }
});
