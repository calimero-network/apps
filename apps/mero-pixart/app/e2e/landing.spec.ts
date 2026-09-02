import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has the MeroPixArt title", async ({ page }) => {
    await expect(page).toHaveTitle(/MeroPixArt/);
  });

  test("renders the hero headline", async ({ page }) => {
    await expect(page.getByText("Your pixels, your nodes.")).toBeVisible();
  });

  test("renders feature cards", async ({ page }) => {
    const features = page.locator("[class*='featureCard']");
    expect(await features.count()).toBeGreaterThanOrEqual(3);
  });

  test("renders a FAQ section", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
  });

  test("header CTA redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.getByRole("button", { name: "Open editor" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Connect to node")).toBeVisible();
  });

  test("hero CTA redirects to /login", async ({ page }) => {
    await page.getByRole("button", { name: /Get started/ }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
