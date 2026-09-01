import { expect, test } from "@playwright/test";

// Smoke coverage for the unauthenticated web entry, which is the state a first
// visitor and a cold CI run are both in: no node, no session in the URL hash.
//
// This is not a formality. The app previously short-circuited on
// `if (!APP_ENABLED) return <LandingPage />`, so on the plain web the router
// never mounted, RequireAuth never ran, and mero-react's login was unreachable —
// the page told visitors to install the desktop app because that was genuinely
// the only way in. mero-meet shipped the same dead end (its RequireAuth answered
// EVERY unauthenticated state with the web-only page). Both are invisible to a
// unit test and to any e2e that starts from an authenticated session, which is
// what the bespoke e2e/*.mjs drivers all do.
test.describe("unauthenticated web entry", () => {
  test("/ redirects to the picker route rather than dead-ending", async ({ page }) => {
    await page.goto("/");
    // App.tsx sends `/` to /live when a stream id is stored and /streams
    // otherwise. A cold browser has no stored context, so it must be /streams.
    await expect(page).toHaveURL(/\/streams$/);
  });

  test("the landing page offers a real way in, not just a download pitch", async ({ page }) => {
    await page.goto("/streams");
    // RequireAuth renders LandingPage when unauthenticated. The ConnectButton is
    // the assertion that matters: it is what makes the web a real entry point
    // instead of a dead end, and it is exactly what the old short-circuit removed.
    await expect(page.getByRole("button", { name: /connect a node/i })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("an unknown route falls back to the entry redirect", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/streams$/);
  });
});
