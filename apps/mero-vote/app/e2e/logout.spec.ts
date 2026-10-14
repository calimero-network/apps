// Log out: from the always-visible top-bar button, or from the session menu.
// Either way the session is gone (mero-react's token store and `mero:*` keys,
// plus the context this browser had open), the visitor is back at the front
// door, and a reload does not sneak them back in.
import { expect, test, type Page } from "@playwright/test";
import { login, waitForPanel } from "./helpers";

async function expectSignedOut(page: Page) {
  await expect(page.getByRole("heading", { name: "Connect a node" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("logout-btn")).toHaveCount(0);
  const left = await page.evaluate(() => ({
    tokens: localStorage.getItem("mero-tokens"),
    applicationId: localStorage.getItem("mero:application_id"),
    contextId: localStorage.getItem("mero:context_id"),
  }));
  expect(left).toEqual({ tokens: null, applicationId: null, contextId: null });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect a node" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Polls", exact: true })).toHaveCount(0);
}

test.describe("log out", () => {
  test("the top-bar Log out button ends the session and returns to the front door", async ({ page }) => {
    await login(page);
    await waitForPanel(page);
    // Signed in for real: the session and the open context are in storage.
    expect(await page.evaluate(() => localStorage.getItem("mero-tokens"))).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mero:context_id"))).not.toBeNull();
    const logout = page.getByTestId("logout-btn");
    await expect(logout).toBeVisible();
    await expect(logout).toHaveText("Log out");
    await logout.click();
    await expectSignedOut(page);
  });

  test("the session menu's Log out does the same, and keeps the theme choice", async ({ page }) => {
    await login(page);
    await waitForPanel(page);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Session" }).click();
    await page.getByTestId("menu-logout-btn").click();
    await expectSignedOut(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("mero-vote:theme"))).toBe("dark");
    await page.evaluate(() => localStorage.removeItem("mero-vote:theme"));
  });

  test("on a phone, Log out stays in the top bar and nothing is wider than the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await waitForPanel(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const logout = page.getByTestId("logout-btn");
    await expect(logout).toBeVisible();
    await expect(logout).toHaveAccessibleName("Log out");
    await logout.click();
    await expectSignedOut(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
