import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The main product loop through a real browser: two users sign up, build agents, enter a debate
 * that runs through the queue (with the fake model), and vote. Forms keeping their input after a
 * rejected submit are checked on the way. Tests run in order and share the users they create.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PASSWORD = "e2e-password-123";
const alice = { name: "Alice E2E", email: `alice-${run}@example.test` };
const bob = { name: "Bob E2E", email: `bob-${run}@example.test` };
let debateUrl = "";

/** A form field by its `name` attribute (labels carry hints whose words can clash). */
const field = (name: string) => `[name="${name}"]`;

async function newUserPage(browser: Browser, user: typeof alice, mode: "sign-up" | "sign-in"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/${mode}`);
  if (mode === "sign-up") await page.locator(field("displayName")).fill(user.name);
  await page.locator(field("email")).fill(user.email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: mode === "sign-up" ? "Create account" : "Sign in" }).click();
  await expect(page).toHaveURL(/\/debates$/);
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();
  return page;
}

async function createAgent(page: Page, name: string, persona: string) {
  await page.goto("/agents/new");
  await page.locator(field("name")).fill(name);
  await page.locator(field("persona")).fill(persona);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

test("sign-in keeps the email after a wrong password", async ({ page }) => {
  // No account yet with this email, so any password is wrong.
  await page.goto("/sign-in");
  await page.locator(field("email")).fill(alice.email);
  await page.locator(field("password")).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page.locator(field("email"))).toHaveValue(alice.email);
});

test("two users sign up and create agents; a rejected agent form keeps its input", async ({ browser }) => {
  const a = await newUserPage(browser, alice, "sign-up");

  await a.goto("/agents/new");
  await a.locator(field("name")).fill("Ada E2E");
  await a.locator(field("style")).fill("asks pointed questions");
  // Long enough for the browser's check, but only one character once the server trims it.
  await a.locator(field("persona")).fill("           x");
  await a.getByRole("button", { name: "Create agent" }).click();
  await expect(a.getByText("Describe the persona in at least 10 characters.")).toBeVisible();
  await expect(a.locator(field("name"))).toHaveValue("Ada E2E");
  await expect(a.locator(field("style"))).toHaveValue("asks pointed questions");

  await a.locator(field("persona")).fill("An urban planner who backs every claim with data from real cities.");
  await a.getByRole("button", { name: "Create agent" }).click();
  await expect(a).toHaveURL(/\/agents$/);
  await expect(a.getByText("Ada E2E", { exact: true })).toBeVisible();

  // Names are unique per user, ignoring case.
  await a.goto("/agents/new");
  await a.locator(field("name")).fill("ada e2e");
  await a.locator(field("persona")).fill("A second agent that wants the same name.");
  await a.getByRole("button", { name: "Create agent" }).click();
  await expect(a.getByText("You already have an agent called “ada e2e”.", { exact: false })).toBeVisible();
  await expect(a.locator(field("persona"))).toHaveValue("A second agent that wants the same name.");

  // Another user can still use the name.
  const b = await newUserPage(browser, bob, "sign-up");
  await createAgent(b, "Ada E2E", "Bob's own Ada, which is allowed.");
  await createAgent(b, "Bram E2E", "A retired taxi driver who distrusts top-down city planning.");
});

test("a rejected debate form keeps its input", async ({ browser }) => {
  const a = await newUserPage(browser, alice, "sign-in");
  await a.goto("/debates/new");
  await a.locator(field("topic")).fill("A topic that will be kept");
  await a.locator(field("rounds")).selectOption("4");
  await a.getByLabel("At a set time").check();
  await a.locator(field("startAtLocal")).fill("2020-01-01T09:00");
  await a.getByRole("button", { name: "Create debate" }).click();
  await expect(a.getByText("The start time must be in the future.")).toBeVisible();
  await expect(a.locator(field("topic"))).toHaveValue("A topic that will be kept");
  await expect(a.locator(field("rounds"))).toHaveValue("4");
  await expect(a.getByLabel("At a set time")).toBeChecked();
  await expect(a.locator(field("startAtLocal"))).toHaveValue("2020-01-01T09:00");
});

test("a debate fills, runs through the queue and opens voting", async ({ browser }) => {
  const a = await newUserPage(browser, alice, "sign-in");
  await a.goto("/debates/new");
  await a.locator(field("topic")).fill("Should every street have trees?");
  await a.locator(field("rounds")).selectOption("2");
  await a.getByLabel("When all slots are filled").check();
  await a.getByRole("button", { name: "Create debate" }).click();
  await expect(a).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);
  debateUrl = a.url();

  await a.getByRole("button", { name: "Enter here" }).first().click();
  await expect(a.getByRole("button", { name: "Withdraw" })).toBeVisible();

  const b = await newUserPage(browser, bob, "sign-in");
  await b.goto(debateUrl);
  await b.locator(field("agentId")).first().selectOption({ label: "Bram E2E" });
  await b.getByRole("button", { name: "Enter here" }).first().click(); // the last slot: it starts

  // Two rounds of two speakers, generated by the fake model through the QStash dev server.
  await expect(b.getByText("Finished", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(b.getByText(/^Scripted argument \d+\./)).toHaveCount(4);
  await expect(b.getByText("Who won? Vote now")).toBeVisible();

  // Bob can't vote for his own agent; Alice votes for Bob's.
  await a.reload();
  await a.getByRole("button", { name: "Vote" }).click();
  await expect(a.getByText(/Leading: Bram E2E/)).toBeVisible();
  await expect(a.getByRole("heading", { name: "Thanks for voting" })).toBeVisible();

  // The debate list says who took part.
  await a.goto("/debates");
  await expect(a.getByText("Ada E2E vs Bram E2E")).toBeVisible();

  // Signing out keeps you on a public page.
  await a.goto(debateUrl);
  await a.getByRole("button", { name: "Sign out" }).click();
  await expect(a.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(a).toHaveURL(debateUrl);
});

test("visitors can watch but not vote, and the leaderboard waits for voting to close", async ({ page }) => {
  await page.goto(debateUrl);
  await expect(page.getByText("Should every street have trees?")).toBeVisible();
  await expect(page.getByText(/^Scripted argument \d+\./)).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Vote" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Who won?", exact: true })).toBeVisible();

  // Signing in from here comes back here.
  const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent(new URL(debateUrl).pathname)}`);

  await page.getByRole("link", { name: "Leaderboard" }).click();
  await expect(page.getByText("No agent has a final result yet.", { exact: false })).toBeVisible();
});

test("unknown pages show a 404 with a way back", async ({ page }) => {
  await page.goto("/debates/does-not-exist");
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await page.getByRole("link", { name: "Browse debates" }).click();
  await expect(page).toHaveURL(/\/debates$/);
});
