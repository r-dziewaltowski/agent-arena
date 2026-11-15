import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e/env";

/**
 * End-to-end tests: a real browser against a production build with a fake model (see e2e/env.ts).
 * Locally they drive the installed Chrome (no browser download); CI installs Playwright's Chromium.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: E2E_BASE_URL,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
