// Light / dark. Light is the default; the sun/moon button in the top bar flips
// it, the choice is remembered under `mero-vote:theme` (Mero Vote's own key),
// and index.html puts it on <html> before the first paint, so a reload never
// flashes light first.
import { expect, test, type Page } from "@playwright/test";
import { login, waitForPanel } from "./helpers";

const KEY = "mero-vote:theme";

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
  test.afterEach(async ({ page }) => {
    await page.evaluate((k) => localStorage.removeItem(k), KEY).catch(() => {});
  });

  test("defaults to light, before and after signing in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect a node" })).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use dark theme");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    expect(await bodyBg(page)).toBe("rgb(246, 247, 251)");

    await page.goto("about:blank");
    await login(page);
    await waitForPanel(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });

  test("the top-bar switch flips the app to dark and back, and the choice survives a reload", async ({ page }) => {
    await login(page);
    await waitForPanel(page);
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");

    await expect(html).not.toHaveAttribute("data-theme", "dark");
    const lightBg = await bodyBg(page);

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-label", "Use light theme");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("dark");
    expect(await bodyBg(page)).not.toBe(lightBg);
    // The frame follows: a card is smoked glass, not white.
    const cardBg = await page
      .locator(".card", { has: page.getByRole("heading", { name: "You", exact: true }) })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).not.toMatch(/^rgba?\(255, 255, 255/);

    await recordThemeAtParse(page);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await themeAtParse(page)).toBe("dark");
    await waitForPanel(page);
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use light theme");

    await page.getByTestId("theme-toggle").click();
    await expect(html).not.toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("light");
    await page.reload();
    await expect(html).not.toHaveAttribute("data-theme", "dark");
    expect(await themeAtParse(page)).toBeNull();
  });
});
