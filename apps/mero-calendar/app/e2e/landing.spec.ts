import { test, expect } from "@playwright/test";

// ⚠️ TRIMMED, twice. `/` is the shared Calimero landing page, whose own
// contract — hero, badge, sections, features, theme, FAQ, the desktop link,
// and now the three pages and the connect popup — is asserted by the generated
// `marketing-landing.spec.ts` beside this file.
//
// This used to assert the CTA landed on `/login` and rendered this app's own
// connect card. That page is gone: the CTA opens a popup over the page you are
// already reading. What is left here is the piece the generated spec cannot
// know — that this app's tab identity is unchanged by the landing's display
// name. No node and no auth, so no mocks.
test.describe("Landing page", () => {
  test("keeps the app's own title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Mero Calendar/i);
  });
});
