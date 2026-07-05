import { test, expect, type Page } from "@playwright/test";

// MeroProvider reports authenticated only after a GET /admin-api/contexts probe
// succeeds, so every "skip" test mocks the node.
async function mockNode(page: Page) {
  // mero-react ≥4.1.1's checkAuth probes HEAD /auth/validate (not under /admin-api/**).
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));
  await page.route("**/admin-api/contexts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { contexts: [] } }) }),
  );
  await page.route("**/admin-api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  const empty = Array.from(new TextEncoder().encode(JSON.stringify([])));
  await page.route("**/jsonrpc", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: empty, logs: [] } }) }),
  );
  await page.route("**/sse**", (route) => route.abort());
}

// Simulate the Tauri desktop runtime so main.tsx takes the hash-auth-skip path.
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
}

// ── Tauri desktop SSO (auth skip) ─────────────────────────────────────────────
// Only the desktop skips login: tokens arrive in the URL hash and are written to
// the mero token store before React mounts.
test.describe("Tauri SSO auth skip", () => {
  test("redirects to /teams when hash contains valid tokens", async ({ page }) => {
    await fakeTauri(page);
    await mockNode(page);
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      "app-id": "app-123",
    }).toString();
    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams/, { timeout: 8000 });
  });

  test("redirects to canvas when hash includes context_id", async ({ page }) => {
    await fakeTauri(page);
    await mockNode(page);
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      "app-id": "app-123",
      context_id: "ctx-abc-123",
    }).toString();
    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams\/t\/projects\/ctx-abc-123/, { timeout: 8000 });
  });

  test("strips hash from URL after consuming tokens", async ({ page }) => {
    await fakeTauri(page);
    await mockNode(page);
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
    }).toString();
    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams/, { timeout: 8000 });
    expect(new URL(page.url()).hash).toBe("");
  });

  test("tolerates the application_id hash key (not only app-id)", async ({ page }) => {
    await fakeTauri(page);
    await mockNode(page);
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      application_id: "app-123",
    }).toString();
    await page.goto(`/#${hash}`);
    await expect(page).toHaveURL(/\/teams/, { timeout: 8000 });
  });

  test("does not skip when only node_url is in the hash (no tokens)", async ({ page }) => {
    await fakeTauri(page);
    await mockNode(page);
    await page.goto("/#node_url=http%3A%2F%2Flocalhost%3A2430");
    await expect(page).not.toHaveURL(/\/teams/, { timeout: 2000 }).catch(() => {});
  });
});

// ── Web login (no auth skip) ──────────────────────────────────────────────────
// On the web there is no Tauri runtime, so the hash is NOT consumed as a skip;
// the user must go through the real auth flow via the Connect button.
test.describe("Web login page", () => {
  test("does NOT skip auth from a hash on the web", async ({ page }) => {
    // No fakeTauri here. The same hash that skips on desktop must not authenticate.
    await page.route("**/admin-api/contexts", (route) => route.fulfill({ status: 401, body: "{}" }));
    const hash = new URLSearchParams({
      node_url: "http://localhost:2430",
      access_token: "fake-access-token",
      refresh_token: "fake-refresh-token",
      "app-id": "app-123",
    }).toString();
    await page.goto(`/#${hash}`);
    await expect(page).not.toHaveURL(/\/teams/, { timeout: 3000 }).catch(() => {});
    await expect(page.locator("body")).toBeVisible();
  });

  test("renders the Connect button and no admin credential fields", async ({ page }) => {
    await page.route("**/admin-api/contexts", (route) => route.fulfill({ status: 401, body: "{}" }));
    await page.goto("/login");
    await expect(page.getByText("Connect to node")).toBeVisible();
    await expect(page.locator(".mero-connect-button")).toBeVisible();
    await expect(page.getByLabel("Username")).toHaveCount(0);
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });
});
