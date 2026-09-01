import { test, expect } from "@playwright/test";

// The landing page is fully static — no node, no auth — so it needs no mocks.
test.describe("Landing page", () => {
  test("renders the hero and primary CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-cta")).toBeVisible();
    // Brand name appears somewhere in the hero/header.
    await expect(page.getByText(/Mero Calendar/i).first()).toBeVisible();
  });

  test("CTA navigates into the auth flow", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("landing-cta").click();
    // Unauthenticated → the connect/login screen.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-connect")).toBeVisible();
  });
});
