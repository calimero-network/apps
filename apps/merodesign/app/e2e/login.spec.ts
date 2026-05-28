import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders connect form", async ({ page }) => {
    await expect(page.getByText("Connect to node")).toBeVisible();
    await expect(page.getByPlaceholder("http://localhost:2430")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  test("pre-fills node URL with localhost default", async ({ page }) => {
    const input = page.getByPlaceholder("http://localhost:2430");
    await expect(input).toHaveValue("http://localhost:2430");
  });

  test("shows error on failed connection", async ({ page }) => {
    // Mock the auth endpoint to fail
    await page.route("**/auth/token", (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ error: "unauthorized" }) }),
    );

    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(
      page.getByText("Connection failed. Check node URL and credentials."),
    ).toBeVisible({ timeout: 5000 });
  });

  test("navigates to /teams on successful login", async ({ page }) => {
    await page.route("**/auth/token", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { access_token: "fake-access", refresh_token: "fake-refresh" },
        }),
      }),
    );

    await page.getByLabel("Password").fill("calimero1234");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page).toHaveURL(/\/teams/, { timeout: 5000 });
  });

  test("connect button disabled while loading", async ({ page }) => {
    // Slow mock to observe loading state
    await page.route("**/auth/token", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { access_token: "t", refresh_token: "r" } }),
      });
    });

    await page.getByLabel("Password").fill("calimero1234");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  });
});
