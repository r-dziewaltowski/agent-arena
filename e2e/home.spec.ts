import { expect, test } from "@playwright/test";

/** The home page: what a signed-out visitor sees first, and where its links lead. */
test("the home page explains the app and leads to sign-up and debates", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Build an AI debater. Send it into the arena.");
  await expect(page.getByRole("heading", { name: "In the arena" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Create a free account" }).click();
  await expect(page).toHaveURL(/\/sign-up$/);

  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "All debates →" }).click();
  await expect(page).toHaveURL(/\/debates$/);
});
