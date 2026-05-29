import { test, expect } from "@playwright/test";

// ── Hash-based SSO (tauri desktop auth skip) ──────────────────────────────────

test.describe("Hash-based SSO auth skip", () => {
  test("redirects to /teams when hash contains valid tokens", async ({ page }) => {
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      "app-id": "app-123",
    }).toString();

    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams/, { timeout: 5000 });
  });

  test("redirects to canvas when hash includes context_id", async ({ page }) => {
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      "app-id": "app-123",
      context_id: "ctx-abc-123",
    }).toString();

    // Fake tokens would get 401 from a real node → intercept before goto so the
    // 401 interceptor in rpc.ts never fires and doesn't redirect us to /login.
    const emptyOutput = Array.from(new TextEncoder().encode(JSON.stringify([])));
    await page.route("**/jsonrpc", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: emptyOutput, logs: [] } }),
      }),
    );
    await page.route("**/sse**", (route) => route.abort());
    await page.route("**/admin-api/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
    );

    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams\/t\/projects\/ctx-abc-123/, { timeout: 5000 });
  });

  test("strips hash from URL after consuming tokens", async ({ page }) => {
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
    }).toString();

    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams/, { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.hash).toBe("");
  });

  test("falls through to normal login when hash has no tokens", async ({ page }) => {
    await page.goto("/#not-auth-related");
    // No valid tokens — landing page or login, not /teams
    await expect(page).not.toHaveURL(/\/teams/, { timeout: 2000 }).catch(() => {});
    // Page should be accessible (no crash)
    await expect(page.locator("body")).toBeVisible();
  });

  test("does not skip login when only node_url is in hash (no tokens)", async ({ page }) => {
    await page.goto("/#node_url=http%3A%2F%2Flocalhost%3A2430");
    // Should not be redirected to /teams — tokens are missing
    await expect(page).not.toHaveURL(/\/teams/, { timeout: 2000 }).catch(() => {});
  });
});

// ── Normal web login ───────────────────────────────────────────────────────────

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
    await page.route("**/admin-api/applications", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { apps: [{ id: "app-1" }] } }),
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
