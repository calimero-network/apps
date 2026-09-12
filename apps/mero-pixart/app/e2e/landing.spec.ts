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

  test("has the Mero PixArt title", async ({ page }) => {
    await expect(page).toHaveTitle(/Mero PixArt/);
  });

  // ⚠️ This used to assert the CTA navigated to `/login`. There is no /login
  // page any more — it opens the shared connection popup over the page you are
  // already on — and the generated spec beside this file owns that contract.
  // What is left here is the one thing it cannot know: that the CTA exists on
  // this app at all, rather than being suppressed as it is for a desktop-only
  // app.
  test("offers a way to connect", async ({ page }) => {
    await expect(
      page.locator("button").filter({ hasText: /^Connect to node$/ }).first(),
    ).toBeVisible();
  });
});
