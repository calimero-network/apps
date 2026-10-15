import { expect, test, type Page } from "@playwright/test";

// Light / dark. Light is the default; the sun/moon button in the top bar flips
// it, the choice is remembered under Mero Sign's own key, and index.html puts
// it on <html> before the first paint, so a reload never flashes light first.
//
// Signed out on an app route is the connect screen, which carries the same
// top bar as the signed-in app, so this needs no node. The node-backed journey
// (e2e/journey/account.journey.ts) presses the same switch signed in.

const KEY = "mero-sign:theme";

/** What <html> said the moment the document was parsed, before any module ran. */
async function recordThemeAtParse(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") {
        (window as unknown as { __themeAtParse?: string | null }).__themeAtParse =
          document.documentElement.getAttribute("data-theme");
      }
    });
  });
}
const themeAtParse = (page: Page) =>
  page.evaluate(() => (window as unknown as { __themeAtParse?: string | null }).__themeAtParse);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("theme", () => {
  test("defaults to light, with nothing saved", async ({ page }) => {
    await recordThemeAtParse(page);
    await page.goto("/workspaces");
    await expect(page.getByTestId("connect-cta")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await themeAtParse(page)).toBe("light");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f6f7fb");
    // The glass ground, light.
    expect(await bodyBg(page)).toBe("rgb(246, 247, 251)");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use dark theme");
  });

  test("the top-bar switch flips the app, and the choice survives a reload", async ({ page }) => {
    await page.goto("/workspaces");
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");
    const lightBg = await bodyBg(page);

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-label", "Use light theme");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("dark");
    expect(await bodyBg(page)).not.toBe(lightBg);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b0e18");

    // Before any module script runs, so there is no flash of light.
    await recordThemeAtParse(page);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await themeAtParse(page)).toBe("dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use light theme");

    await page.getByTestId("theme-toggle").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("light");
    await page.reload();
    expect(await themeAtParse(page)).toBe("light");
    expect(await bodyBg(page)).toBe(lightBg);
  });

  test("the choice is Mero Sign's own, not a key another app shares", async ({ page }) => {
    await page.goto("/workspaces");
    await page.getByTestId("theme-toggle").click();
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain(KEY);
    for (const shared of ["theme", "app:theme", "mc-theme", "mero-crm:theme"]) {
      expect(keys).not.toContain(shared);
    }
  });

  test("a choice made on the landing page carries into the app", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("theme-toggle").first().click();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("dark");
    await page.goto("/workspaces");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use light theme");
  });

  test("on a phone the switch is in the top bar and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/workspaces");
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
