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

  test("has correct page title", async ({ page }) => {
    await expect(page).toHaveTitle(/Mero Design/);
  });

  // ⚠️ This used to assert the CTA navigated to `/login`. There is no /login
  // page any more — it opens the shared connection popup over the page you are
  // already on — and the generated spec beside this file owns that contract.
  test("offers a way to connect", async ({ page }) => {
    await expect(
      page.locator("button").filter({ hasText: /^Connect to node$/ }).first(),
    ).toBeVisible();
  });
});
