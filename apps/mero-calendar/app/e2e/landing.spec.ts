import { test, expect } from "@playwright/test";

// ⚠️ TRIMMED. `/` is now the shared Calimero landing page, whose own contract —
// hero, badge, sections, features, theme, FAQ, the desktop link — is asserted by
// the generated `marketing-landing.spec.ts` beside this file. What is left here
// is the part that spec does not cover: the CTA is not just present, it lands on
// this app's connect screen. No node and no auth, so no mocks.
test.describe("Landing page", () => {
  test("the CTA navigates into the auth flow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Connect to node" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-connect")).toBeVisible();
  });
});
