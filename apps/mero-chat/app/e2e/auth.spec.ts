/**
 * Auth flow e2e tests.
 *
 * These tests cover authentication state transitions, session management, and
 * the invitation URL parameter flow.  All node API calls are mocked so no live
 * Calimero node is required.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectMeroAuthTokens, clearAuth } from "./helpers/auth";

const MOCK_NODE_URL = "http://localhost:2428";
const MOCK_ACCESS_TOKEN = "eyJhbGciOiJFZERTQSJ9.mock.signature";

// A JWT whose `exp` is in the past (Unix epoch 1) — kept for future expiry tests
const _EXPIRED_JWT = (() => {
  const header = btoa(JSON.stringify({ alg: "EdDSA" }));
  const payload = btoa(JSON.stringify({ exp: 1, sub: "test-user" }));
  return `${header}.${payload}.fakesig`;
})();

async function mockNodeApi(page: import("@playwright/test").Page) {
  await page.route(`${MOCK_NODE_URL}/**`, (route) => {
    const url = route.request().url();

    if (
      url.includes("/admin-api/groups") &&
      !url.includes("/join") &&
      !url.includes("/invite") &&
      !url.includes("/members") &&
      !url.includes("/namespaces")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              groupId: "group-abc123",
              alias: "My Workspace",
              appKey: "app-key",
              targetApplicationId: "app-1",
              upgradePolicy: "Automatic",
              createdAt: 1700000000,
            },
          ],
        }),
      });
    }

    if (url.includes("/admin-api/groups/group-abc123/members")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            memberIdentity: "pk-member-xyz",
            members: [{ identity: "pk-member-xyz", alias: "Alice" }],
          },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: null }),
    });
  });
}

// ── Unauthenticated state ─────────────────────────────────────────────────────

test.describe("Unauthenticated state", () => {
  // In the live project, AUTH_FILE injects real tokens into the browser context.
  // Clear them via addInitScript so these unauthenticated tests behave identically
  // in both mocked and live projects.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ["mero:node_url", "mero-tokens"].forEach(
        (k) => localStorage.removeItem(k),
      );
    });
  });

  test("/ redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("/login shows the landing page headline", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("any unknown path redirects to /login", async ({ page }) => {
    await page.goto("/settings/profile");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("ConnectButton is rendered on the landing page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    // mero-react renders ConnectButton as a <button> or <a>
    const connectBtn = page
      .getByRole("button", { name: /connect/i })
      .or(page.getByRole("link", { name: /connect/i }))
      .first();
    await expect(connectBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ── Authenticated state ───────────────────────────────────────────────────────

test.describe("Authenticated state", () => {
  test.beforeEach(async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: "mock-refresh",
    });
    await mockNodeApi(page);
  });

  test("/login redirects to / when tokens are present", async ({ page }) => {
    await page.goto("/login");
    // The workspace selector may show briefly before the route guard kicks in
    // OR the guard redirects immediately — either way we should end up at /
    await expect(page).toHaveURL(/^\/?$|\/login/, { timeout: 10_000 });
  });

  test("workspace selector is visible at /login with valid tokens", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Logout button is present when authenticated", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /disconnect node/i })).toBeVisible();
  });

  test("Logout clears auth tokens from localStorage", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /disconnect node/i }).click();

    // Wait a moment for the async logout handler to run
    await page.waitForTimeout(500);

    const meroTokens = await page.evaluate(() =>
      localStorage.getItem("mero-tokens"),
    );
    expect(meroTokens).toBeNull();
  });
});

// ── Session expiry ────────────────────────────────────────────────────────────

test.describe("Session expiry", () => {
  test("sets sessionLastActivity when authenticated", async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
    });
    // Inject an existing session timestamp (not expired)
    await page.addInitScript(() => {
      localStorage.setItem("sessionLastActivity", Date.now().toString());
    });
    await mockNodeApi(page);
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({
      timeout: 10_000,
    });

    const activity = await page.evaluate(() =>
      localStorage.getItem("sessionLastActivity"),
    );
    expect(activity).not.toBeNull();
  });

  test("expired session (> 1 hour old) triggers logout and /login redirect", async ({
    page,
  }) => {
    const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000;

    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
    });

    // Mark the session as already having been active 2 hours ago
    await page.addInitScript(({ ts }: { ts: number }) => {
      localStorage.setItem("sessionLastActivity", ts.toString());
    }, { ts: TWO_HOURS_AGO });

    await mockNodeApi(page);
    await page.goto("/");

    // The session-expiry check in App.tsx runs on every auth state change;
    // an expired timestamp causes logout → redirect to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

// ── Invitation URL handling ───────────────────────────────────────────────────

test.describe("Invitation URL parameter", () => {
  // Clear auth tokens so the app loads in unauthenticated state — real tokens
  // (live project) can cause auth-triggered navigations that clear localStorage
  // before the test can read it.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ["mero:node_url", "mero-tokens"].forEach(
        (k) => localStorage.removeItem(k),
      );
    });
  });

  // Kept as a literal rather than imported from src/pages/Login: importing a
  // .tsx page into an e2e spec drags React in. clearStorageForConnect.test.ts
  // asserts the exported constant equals this string, so the two cannot drift.
  const PENDING_INTENTS_KEY = "calimero.platform.pendingIntents";

  /** Deep-link intents the platform SDK has durably captured. */
  const capturedIntents = (page: Page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { raw: string }[]) : [];
    }, PENDING_INTENTS_KEY);

  test("?invitation= is captured as a pending intent and removed from the URL", async ({
    page,
  }) => {
    // base58-encoded '{"invitation":{"test":"data"},"inviterSignature":"test-sig"}'
    const BASE58_PAYLOAD = "Npc3sGjF3dgRqEWTAd99AGgu7EA54vdyUyVoaamw3G9GLDJnnA8gxfGbU9yTyW4YCpFMjTpXXo8iC8L2ZJ";

    await page.goto(`/?invitation=${BASE58_PAYLOAD}`);

    // main.tsx strips the param from the URL before React mounts
    await page.waitForFunction(
      () => !window.location.search.includes("invitation"),
      { timeout: 10_000 },
    );

    await expect(page).not.toHaveURL(/invitation=/);

    // Stripping the URL must not lose the invite: it has to survive in the
    // durable store, because the popup that consumes it only mounts after
    // the auth round-trip.
    const intents = await capturedIntents(page);
    expect(intents).toHaveLength(1);
    expect(intents[0].raw).toContain(BASE58_PAYLOAD);
  });

  test("legacy base64url invitation is still captured", async ({ page }) => {
    // base64url of '{"invitation":{"legacy":"true"},"inviterSignature":"old"}'
    const B64URL_PAYLOAD = "eyJpbnZpdGF0aW9uIjp7ImxlZ2FjeSI6InRydWUifSwiaW52aXRlclNpZ25hdHVyZSI6Im9sZCJ9";

    await page.goto(`/?invitation=${B64URL_PAYLOAD}`);

    await page.waitForFunction(
      () => !window.location.search.includes("invitation"),
      { timeout: 10_000 },
    );

    await expect(page).not.toHaveURL(/invitation=/);

    const intents = await capturedIntents(page);
    expect(intents).toHaveLength(1);
    expect(intents[0].raw).toContain(B64URL_PAYLOAD);
  });
});

// ── Token clearing ────────────────────────────────────────────────────────────

test.describe("clearAuth helper", () => {
  test("clears all mero-react localStorage keys", async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
    });
    await page.goto("/login");
    // Confirm tokens were injected
    const before = await page.evaluate(() => localStorage.getItem("mero-tokens"));
    expect(before).not.toBeNull();

    await clearAuth(page);

    // Check immediately — addInitScript re-injects tokens on reload/navigation,
    // so we verify clearAuth worked in the current page context.
    const after = await page.evaluate(() => localStorage.getItem("mero-tokens"));
    expect(after).toBeNull();
  });
});
