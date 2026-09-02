import { test, expect } from "@playwright/test";

/**
 * IMPORTANT.md item 13 — "Use svg icon for bundle also for logos inside the
 * application and as favicon.ico and metadata".
 *
 * Mostly landed already (favicon.svg, favicon.ico, apple-touch-icon, webmanifest,
 * the bundle manifest icon). This covers the remainder and guards the set.
 */
test.describe("item 13: the icon everywhere", () => {
  test("the SVG favicon is declared with its type", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('link[rel="icon"][type="image/svg+xml"]');
    await expect(link).toHaveCount(1);
    expect(await link.getAttribute("href")).toContain("favicon.svg");
  });

  test("every declared icon resolves", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').evaluateAll(
      (els) => els.map((e) => (e as HTMLLinkElement).getAttribute("href")!),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      const res = await request.get(new URL(href, page.url()).toString());
      expect(res.status(), href).toBe(200);
    }
  });

  test("the manifest's icons resolve too", async ({ page, request }) => {
    await page.goto("/");
    const manifest = await (await request.get(new URL("/site.webmanifest", page.url()).toString())).json();
    for (const icon of manifest.icons ?? []) {
      const res = await request.get(new URL(icon.src, page.url()).toString());
      expect(res.status(), icon.src).toBe(200);
    }
  });

  test("the in-app logo is an inline svg, not a raster", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("svg").first()).toBeVisible();
  });

  test("social metadata carries the icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  });
});
