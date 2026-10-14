// Light / dark inside the app. Light is the default; the sun/moon button in
// the top bar flips it, the choice is remembered under `mero-updates:theme`,
// and index.html puts it on <html> before the first paint, so a reload never
// flashes light first. (tests/theme.spec.ts covers the default and the
// pre-paint script without a node.)
import { expect, test, type Page } from "@playwright/test";

import { enterNewAudience } from "./helpers";

const KEY = "mero-updates:theme";

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

test("the top-bar switch flips the app to dark and back, and the choice survives a reload", async ({ page }) => {
  await enterNewAudience(page, "Theme Co");
  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");

  await expect(html).not.toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", "Use dark theme");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightCard = await page.evaluate(
    () => getComputedStyle(document.querySelector(".appTitle")!).backgroundColor,
  );

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", "Use light theme");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("dark");
  // The page AND the cards on it changed, not just the attribute.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector(".appTitle")!).backgroundColor),
  ).not.toBe(lightCard);

  await recordThemeAtParse(page);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await themeAtParse(page)).toBe("dark");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use light theme", {
    timeout: 30_000,
  });

  // Settings → Your account says the same thing and can set it too.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("appearance-dark")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("appearance-light").click();
  await expect(html).not.toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use dark theme");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("light");
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme", "dark");
  expect(await themeAtParse(page)).toBeNull();
});
