import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders MeroDesign logo in header", async ({ page }) => {
    await expect(page.locator("header").getByText("MeroDesign")).toBeVisible();
  });

  test("renders hero headline", async ({ page }) => {
    await expect(page.getByText("Collaborative design.")).toBeVisible();
  });

  test("renders four feature cards", async ({ page }) => {
    const features = page.locator(".features .feature, [class*='features'] [class*='feature']");
    await expect(features).toHaveCount(4);
  });

  test("renders FAQ section with at least 3 items", async ({ page }) => {
    await expect(page.getByText("FAQ")).toBeVisible();
    const faqItems = page.locator("[class*='faqItem']");
    expect(await faqItems.count()).toBeGreaterThanOrEqual(3);
  });

  test("Connect button navigates to /login", async ({ page }) => {
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("Get started button navigates to /login", async ({ page }) => {
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("has correct page title", async ({ page }) => {
    await expect(page).toHaveTitle(/MeroDesign/);
  });
});
