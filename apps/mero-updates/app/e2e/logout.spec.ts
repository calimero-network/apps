// Log out: from the sidebar's identity footer, from the phone nav drawer, or
// from Settings → Your account. Each way the session is gone (mero-react's
// tokens and this app's open audience), the visitor is back on the front door,
// and a reload or a deep link into the app does not sneak them back in.
import { expect, test, type Page } from "@playwright/test";

import { enterNewAudience } from "./helpers";

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible({ timeout: 15_000 });
  const left = await page.evaluate(() => ({
    accessToken: localStorage.getItem("mero:access_token"),
    tokens: localStorage.getItem("mero-tokens"),
    audiences: Object.keys(localStorage).filter((k) => k.startsWith("mu-space:")),
    sessionContext: JSON.parse(localStorage.getItem("mu-session") ?? "{}").contextId ?? null,
  }));
  expect(left).toEqual({ accessToken: null, tokens: null, audiences: [], sessionContext: null });

  // Still signed out after a reload, and the app routes send them home.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/a");
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId("composer")).toHaveCount(0);
}

test("the sidebar's Log out ends the session and returns to the landing page", async ({ page }) => {
  await enterNewAudience(page, "Logout Co");
  const sidebar = page.getByRole("complementary", { name: "Audience" });
  await expect(sidebar.getByTestId("session-node")).toBeVisible();
  await sidebar.getByTestId("logout").click();
  await expectSignedOut(page);
});

test("on a phone, Log out is in the nav drawer the top bar opens", async ({ page }) => {
  await enterNewAudience(page, "Phone Co");
  await page.setViewportSize({ width: 390, height: 844 });
  // No rail on a phone: the nav lives behind the menu button.
  const drawer = page.getByTestId("mobile-nav");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("link", { name: "KPIs" })).toHaveCount(0);
  await page.getByTestId("mobile-nav-btn").click();
  await expect(drawer).toBeVisible();
  // Navigating closes the drawer.
  await drawer.getByRole("link", { name: "KPIs" }).click();
  await expect(page).toHaveURL(/\/a\/metrics$/);
  await expect(drawer).toBeHidden();
  // Escape closes it too.
  await page.getByTestId("mobile-nav-btn").click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // Nothing on the page is wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByTestId("mobile-nav-btn").click();
  await drawer.getByTestId("logout").click();
  await expectSignedOut(page);
});

test("Settings → Your account → Log out does the same, and keeps the theme choice", async ({ page }) => {
  await enterNewAudience(page, "Settings Co");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
  await page.getByTestId("appearance-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("settings-logout").click();
  await expectSignedOut(page);
  expect(await page.evaluate(() => localStorage.getItem("mero-updates:theme"))).toBe("dark");
  await page.evaluate(() => localStorage.removeItem("mero-updates:theme"));
});

test("the company picker's Log out signs out too", async ({ page }) => {
  await enterNewAudience(page, "Picker Co");
  await page.getByRole("button", { name: "Audiences", exact: true }).click();
  await expect(page).toHaveURL(/\/companies\/[^/]+$/);
  await page.getByTestId("logout").click();
  await expectSignedOut(page);
});
