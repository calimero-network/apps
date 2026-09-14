import { test, expect } from "@playwright/test";

// ⚠️ This file used to test a `/login` route that no longer exists. Every app
// had one; every one rendered its name, its description and a connect button
// in its own styling, so pressing "Connect to node" on the landing page took
// you to a second, unrelated-looking page to press a second button.
//
// What replaced it is a popup over the page you are already reading, and the
// generated `marketing-landing.spec.ts` owns that contract. What is left here
// is the one thing specific to this app: the connect card is reachable from
// the front door without a detour.
test.describe("Connecting", () => {
  test("the front door offers a way in, with no separate login page", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.locator("button").filter({ hasText: /^Connect to node$/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("/login redirects rather than rendering a second sign-in page", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });
});
