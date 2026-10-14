import { test, expect } from "@playwright/test";

/**
 * Light / dark. The switch itself lives in the signed-in top bar (covered by
 * src/theme/theme.test.tsx); what only a real browser shows is the bootstrap:
 * index.html puts the saved theme on <html> before the first paint, so a
 * reload never flashes light first.
 */
test.describe("Theme", () => {
  test("defaults to light", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("mero-chat:theme"))).toBeNull();
  });

  test("a saved dark theme is on <html> before the app runs, across reloads", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.setItem("mero-chat:theme", "dark"));

    // Record what <html> says the moment the document is parsed, before any
    // module script has run.
    await page.addInitScript(() => {
      document.addEventListener("readystatechange", () => {
        if (document.readyState === "interactive") {
          (window as unknown as { __themeAtParse?: string | null }).__themeAtParse =
            document.documentElement.getAttribute("data-theme");
        }
      });
    });

    for (let i = 0; i < 2; i++) {
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      const atParse = await page.evaluate(
        () => (window as unknown as { __themeAtParse?: string | null }).__themeAtParse,
      );
      expect(atParse).toBe("dark");
    }

    await page.evaluate(() => localStorage.setItem("mero-chat:theme", "light"));
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });
});
