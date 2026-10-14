import { expect, test } from "@playwright/test";

/**
 * Light / dark without a node: light by default, and a stored dark choice is
 * on <html> before any module runs (index.html's pre-paint script), so the
 * app never flashes light on a reload. The in-app switch itself needs a signed
 * -in shell and is covered by e2e/theme.spec.ts.
 */
const KEY = "mero-updates:theme";

test("defaults to light and stores nothing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test("a stored dark choice is applied before the first paint", async ({ page }) => {
  await page.addInitScript((k) => {
    localStorage.setItem(k, "dark");
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") {
        (window as unknown as { __themeAtParse?: string | null }).__themeAtParse =
          document.documentElement.getAttribute("data-theme");
      }
    });
  }, KEY);
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { __themeAtParse?: string | null }).__themeAtParse)).toBe(
    "dark",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b0e18");
});

test("another app's theme key does not darken this one", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mero-crm:theme", "dark"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});
