import { test, expect } from "@playwright/test";

test.describe("Landing page (unauthenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    // Wait for the LandingPage headline to appear before each assertion.
    // This absorbs Vite's first-request compilation time and MeroProvider init.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("redirects to /login when no auth tokens are present", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("shows Mero Chat branding", async ({ page }) => {
    await expect(page.getByText("Mero Chat", { exact: true })).toBeVisible();
  });

  test("shows the private messaging headline", async ({ page }) => {
    await expect(page.getByText("Private messaging,")).toBeVisible();
  });

  test("shows the owned-by-you tagline", async ({ page }) => {
    await expect(page.getByText("owned by you")).toBeVisible();
  });

  test("renders feature chips", async ({ page }) => {
    await expect(page.getByText("End-to-end encrypted")).toBeVisible();
    await expect(page.getByText("Self-hosted node")).toBeVisible();
    await expect(page.getByText("Invite-only access")).toBeVisible();
    await expect(page.getByText("Zero data collection")).toBeVisible();
  });

  test("unknown routes redirect to /login", async ({ page }) => {
    await page.goto("/nonexistent-path");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
