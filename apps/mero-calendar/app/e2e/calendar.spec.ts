import { test, expect } from "@playwright/test";

// Route guards. The authenticated calendar render itself is covered end-to-end
// by the integration suite (e2e/integration/rpc.spec.ts) against a real node —
// mero-react's auth state machine isn't cleanly mockable in a unit-style page
// test, so here we assert the guard behavior that IS deterministic: protected
// routes bounce an unauthenticated visitor to the front door.
//
// ⚠️ That used to be `/login`. There is no login page any more — its whole
// content was a button the visitor had already pressed to get there — so the
// guard sends them to `/`, which is the landing page and where the way in now
// lives.
test.describe("Route guards", () => {
  test("redirects unauthenticated users away from /teams", async ({ page }) => {
    await page.goto("/teams");
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
    await expect(
      page.locator("button").filter({ hasText: /^Connect to node$/ }).first(),
    ).toBeVisible();
  });

  test("redirects unauthenticated users away from a calendar route", async ({ page }) => {
    await page.goto("/teams/team-x/calendar/ctx-x");
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  });

  // The calendar picker is a THIRD protected route, added after the two above.
  // A route registered without RequireAuth renders for anyone and reads as
  // working, because it is only the node calls behind it that fail.
  test("redirects unauthenticated users away from a team's calendar picker", async ({ page }) => {
    await page.goto("/teams/team-x");
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  });
});
