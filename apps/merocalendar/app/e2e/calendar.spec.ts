import { test, expect } from "@playwright/test";

// Route guards. The authenticated calendar render itself is covered end-to-end
// by the integration suite (e2e/integration/rpc.spec.ts) against a real node —
// mero-react's auth state machine isn't cleanly mockable in a unit-style page
// test, so here we assert the guard behavior that IS deterministic: protected
// routes bounce an unauthenticated visitor to /login.
test.describe("Route guards", () => {
  test("redirects unauthenticated users away from /teams", async ({ page }) => {
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    await expect(page.getByTestId("login-connect")).toBeVisible();
  });

  test("redirects unauthenticated users away from a calendar route", async ({ page }) => {
    await page.goto("/teams/team-x/calendar/ctx-x");
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });
});
