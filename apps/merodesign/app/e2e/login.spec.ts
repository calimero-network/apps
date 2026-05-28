import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders connect form with only node url field", async ({ page }) => {
    await expect(page.getByText("Connect to node")).toBeVisible();
    await expect(page.getByPlaceholder("http://localhost:2430")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
    await expect(page.getByLabel("Username")).not.toBeVisible();
    await expect(page.getByLabel("Password")).not.toBeVisible();
  });

  test("pre-fills node URL with localhost default", async ({ page }) => {
    const input = page.getByPlaceholder("http://localhost:2430");
    await expect(input).toHaveValue("http://localhost:2430");
  });

  test("shows error on failed connection", async ({ page }) => {
    await page.route("**/auth/token", (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ error: "unauthorized" }) }),
    );

    await page.getByRole("button", { name: "Connect" }).click();

    await expect(
      page.getByText("Could not connect. Make sure the node is running."),
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

    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page).toHaveURL(/\/teams/, { timeout: 5000 });
  });

  test("connect button disabled while loading", async ({ page }) => {
    await page.route("**/auth/token", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { access_token: "t", refresh_token: "r" } }),
      });
    });

    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  });
});
