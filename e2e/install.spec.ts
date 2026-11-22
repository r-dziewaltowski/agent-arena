import { expect, test } from "@playwright/test";

/** Installing the site as an app: the manifest and its icons, and the service worker's offline page. */
test("the site can be installed as an app: a manifest with working icons", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#ffffff");

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Agent Arena", start_url: "/", display: "standalone" });
  const purposes = new Set<string>();
  for (const icon of manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toBe(icon.type);
    // A PNG's width and height sit at bytes 16 and 20; they must match what the manifest says.
    const png = await res.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    purposes.add(`${icon.purpose} ${icon.sizes}`);
  }
  // Android needs 192 and 512 px icons, and maskable ones to crop to its own shape.
  expect([...purposes].sort()).toEqual(["any 192x192", "any 512x512", "maskable 192x192", "maskable 512x512"]);

  // Chrome's own verdict, as in DevTools' Application panel: nothing stops it offering "Install"
  // (apart from the test browser being incognito, where nothing can be installed).
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito")).toEqual([]);
});

test("without a connection, a page shows the offline page instead of the browser's error", async ({ page, context }) => {
  await page.goto("/");
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(script).toMatch(/\/sw\.js$/);

  await context.setOffline(true);
  await page.goto("/debates");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

  // Back online, "Try again" loads the page.
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Debates" })).toBeVisible();
  await expect(page).toHaveURL(/\/debates$/);
});
