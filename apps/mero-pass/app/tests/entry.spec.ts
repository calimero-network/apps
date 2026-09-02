import { expect, test } from "@playwright/test";

// Smoke coverage for the unauthenticated entry — the state a first visitor and
// a cold CI run are both in: no node, no session in the URL hash.
//
// ci.yml's browser job has no opt-out: it runs `npx playwright test` for every
// changed app, so an app with no config fails outright. But this is not a
// formality either — the app previously hard-coded a developer's local node
// (`http://node1.127.0.0.1.nip.io`) into its connect button, so a deployed
// build pointed every user at a machine that was not theirs. The assertion that
// a real connect affordance renders is what would have caught the replacement
// going missing.
test.describe("unauthenticated entry", () => {
  test("the entry route renders and offers a way to connect", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /connect a node/i })).toBeVisible();
  });

  test("the page identifies itself as MeroPass", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/mero-pass/i);
    // The brand in the navbar, not just the tab — a blank shell would still
    // have the right title.
    await expect(page.getByText("MeroPass").first()).toBeVisible();
  });

  test("an unknown route does not render a blank page", async ({ page }) => {
    // There is no catch-all route, so this asserts the app shell still mounts
    // rather than the bundle failing to boot.
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("#root")).toBeAttached();
  });
});
