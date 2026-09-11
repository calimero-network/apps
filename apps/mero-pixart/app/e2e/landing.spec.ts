import { test, expect } from "@playwright/test";

// ⚠️ TRIMMED. `/` is now the shared Calimero landing page, whose own contract —
// hero, badge, sections, features, theme, FAQ, the desktop link — is asserted by
// the generated `marketing-landing.spec.ts` beside this file. What is left here
// is what that spec does not cover: the tab identity, which the landing's
// display name deliberately does NOT change, and that the CTA really lands on
// the connect screen rather than merely existing.
test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has the MeroPixArt title", async ({ page }) => {
    await expect(page).toHaveTitle(/MeroPixArt/);
  });

  test("the CTA redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.getByRole("link", { name: "Connect to node" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Connect to node").first()).toBeVisible();
  });
});
