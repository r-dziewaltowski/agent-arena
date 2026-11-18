import { expect, test, type Browser, type Page } from "@playwright/test";
import { makeAdmin } from "./db";
import { emailCount, linkFromEmail } from "./outbox";

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

/** A tiny red PNG, for uploading an agent's picture. */
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4o2EDRwzEcQASUhQBSAx55AAAAABJRU5ErkJggg==",
  "base64",
);

/** A form field by its `name` attribute (labels carry hints whose words can clash). */
const field = (name: string) => `[name="${name}"]`;

async function newUserPage(browser: Browser, user: typeof alice, mode: "sign-up" | "sign-in"): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/${mode}`);
  if (mode === "sign-up") await page.locator(field("displayName")).fill(user.name);
  await page.locator(field("email")).fill(user.email);
  await page.locator(field("password")).fill(PASSWORD);
  await page.getByRole("button", { name: mode === "sign-up" ? "Create account" : "Sign in" }).click();
  if (mode === "sign-up") {
    // New accounts confirm their email first: follow the link from the outbox.
    await expect(page.getByText("Check your email")).toBeVisible();
    await page.goto(await linkFromEmail(user.email, "Confirm your email"));
    await expect(page.getByRole("heading", { name: `You're in, ${user.name}` })).toBeVisible();
    await page.getByRole("link", { name: "Continue" }).click();
  }
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
  await a.locator(field("styleChoice")).selectOption({ label: "Write your own…" });
  await a.locator(field("styleCustom")).fill("asks pointed questions");
  await a.locator(field("toneChoice")).selectOption({ label: "Dry" });
  // Long enough for the browser's check, but only one character once the server trims it.
  await a.locator(field("persona")).fill("           x");
  await a.getByRole("button", { name: "Create agent" }).click();
  await expect(a.getByText("Describe the persona in at least 10 characters.")).toBeVisible();
  await expect(a.locator(field("name"))).toHaveValue("Ada E2E");
  await expect(a.locator(field("styleChoice"))).toHaveValue("__custom");
  await expect(a.locator(field("styleCustom"))).toHaveValue("asks pointed questions");
  await expect(a.locator(field("toneChoice"))).toHaveValue("dry");

  await a.locator(field("persona")).fill("An urban planner who backs every claim with data from real cities.");
  await a.getByRole("button", { name: "Create agent" }).click();
  await expect(a).toHaveURL(/\/agents$/);
  await expect(a.getByText("Ada E2E", { exact: true })).toBeVisible();
  // The custom style and the chosen tone were saved.
  // (Next keeps the previous page mounted but hidden, so only visible matches count.)
  await expect(a.getByText("Asks pointed questions", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(a.getByText("Dry", { exact: true }).filter({ visible: true })).toBeVisible();

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

  // A voice and how it speaks, kept on the agent.
  const bramPage = await b.getByRole("link", { name: "Bram E2E", exact: true }).filter({ visible: true }).getAttribute("href");
  await b.goto(`${bramPage}/edit`);
  await expect(b.locator(field("name"))).toHaveValue("Bram E2E");
  await b.locator(field("voice")).selectOption({ label: "Algenib · gravelly" });
  await b.getByRole("button", { name: "A gravelly old sea captain" }).click();
  // A picture, shrunk to a small square in the browser before it's sent.
  await b.locator('input[type="file"]:not([name])').setInputFiles({ name: "bram.png", mimeType: "image/png", buffer: PICTURE });
  await expect(b.getByRole("button", { name: "Remove picture" })).toBeVisible();
  await b.getByRole("button", { name: "Save changes" }).click();
  await expect(b).toHaveURL(/\/agents$/);
  await b.goto(`${bramPage}/edit`);
  await expect(b.locator(field("voice"))).toHaveValue("Algenib");
  await expect(b.locator(field("voiceStyle"))).toHaveValue("A gravelly old sea captain");
  const picture = b.locator('main img[src*="/image?v="]').first();
  await expect(picture).toBeVisible();
  const response = await b.request.get((await picture.getAttribute("src"))!);
  expect(response.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
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

test("dropdown hints describe the chosen option", async ({ browser }) => {
  const a = await newUserPage(browser, alice, "sign-in");
  await a.goto("/debates/new");
  await expect(a.getByText("Each user sees the counts once they've voted", { exact: false })).toBeVisible();
  await a.locator(field("tallyVisibility")).selectOption("live");
  await expect(a.getByText("Everyone sees the counts while voting is open")).toBeVisible();

  await a.goto("/agents/new");
  await expect(a.getByText("Strongest free model. Fast, sharp rebuttals.")).toBeVisible();
  await a.locator(field("stance")).selectOption("mediator");
  await expect(a.getByText("Tries to bring opposing sides together.")).toBeVisible();
});

test("deleting asks first, in the app's own dialog", async ({ browser }) => {
  const a = await newUserPage(browser, alice, "sign-in");
  await a.goto("/debates/new");
  await a.locator(field("topic")).fill("A debate that will be deleted");
  await a.getByRole("button", { name: "Create debate" }).click();
  await expect(a).toHaveURL(/\/debates\/[0-9a-f-]{36}$/);

  await a.getByRole("button", { name: "Delete debate" }).click();
  const dialog = a.getByRole("dialog");
  await expect(dialog.getByText("Delete this debate? Entered agents are withdrawn.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(a.getByText("A debate that will be deleted")).toBeVisible();

  await a.getByRole("button", { name: "Delete debate" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(a).toHaveURL(/\/debates$/);
  await expect(a.getByText("A debate that will be deleted").filter({ visible: true })).toHaveCount(0);
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

  // Listening plays each turn's speech (a stand-in voice here) while the text keeps step.
  const listen = b.getByRole("button", { name: "Listen" });
  await expect(listen).toBeVisible({ timeout: 20_000 });
  const audio = b.waitForResponse((r) => /\/turns\/[0-9a-f-]+\/audio$/.test(r.url()) && r.ok(), { timeout: 30_000 });
  await listen.click();
  await expect(b.getByRole("button", { name: /Listening|Start sound/ })).toHaveAttribute("aria-pressed", "true");
  expect((await audio).headers()["content-type"]).toBe("audio/mpeg");

  // Each speaker's picture by their turns: Bram's upload, Ada's drawn face.
  await expect(b.locator('article img[src*="/image?v="]').first()).toBeVisible({ timeout: 30_000 });
  await expect(b.locator('article img[src*="/api/avatars/"]').first()).toBeVisible({ timeout: 30_000 });

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
  await expect(page.getByRole("link", { name: "Sign in to report a problem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who won?", exact: true })).toBeVisible();

  // Signing in from here comes back here.
  const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent(new URL(debateUrl).pathname)}`);

  await page.getByRole("link", { name: "Leaderboard" }).click();
  await expect(page.getByText("No agent has a final result yet.", { exact: false })).toBeVisible();
});

test("a viewer reports a turn once; an admin removes its text from the admin page", async ({ browser }) => {
  await makeAdmin(bob.email);
  const emailsBefore = emailCount(bob.email);
  const a = await newUserPage(browser, alice, "sign-in");
  await a.goto(debateUrl);

  const report = async () => {
    await a.getByRole("button", { name: "Report" }).click();
    const turn = await a.locator(`${field("about")} option`, { hasText: "Turn 2 by Bram E2E" }).getAttribute("value");
    await a.locator(field("about")).selectOption(turn!);
    await a.locator(field("reason")).selectOption("offensive");
    await a.locator(field("note")).fill("Testing reports.");
    await a.getByRole("button", { name: "Send report" }).click();
  };
  await report();
  await expect(a.getByRole("heading", { name: "Thanks for the report" })).toBeVisible();
  // The admin hears about it.
  await expect.poll(() => emailCount(bob.email)).toBeGreaterThan(emailsBefore);
  // Reporting the same turn again is refused.
  await a.reload();
  await report();
  await expect(a.getByText("You've already reported this.", { exact: false })).toBeVisible();

  // The admin reviews it and removes the turn's text.
  const b = await newUserPage(browser, bob, "sign-in");
  await b.getByRole("link", { name: /^admin · \d+ to review$/ }).click();
  await expect(b.getByRole("heading", { name: "Reports to review (1)" })).toBeVisible();
  await expect(b.getByText("Turn 2 by Bram E2E")).toBeVisible();
  await expect(b.getByText("“Testing reports.”")).toBeVisible();
  await b.getByRole("button", { name: "Remove this turn's text" }).click();
  await b.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(b.getByText("Nothing to review.")).toBeVisible();
  await b.goto(debateUrl);
  await expect(b.getByText("This turn was removed by an admin after a report.")).toBeVisible();
  await expect(b.getByText(/^Scripted argument \d+\./)).toHaveCount(3);
});

test("unknown pages show a 404 with a way back", async ({ page }) => {
  await page.goto("/debates/does-not-exist");
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await page.getByRole("link", { name: "Browse debates" }).click();
  await expect(page).toHaveURL(/\/debates$/);
});
