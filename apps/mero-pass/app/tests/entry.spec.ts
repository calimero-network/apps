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
//
// ⚠️ `/` is now the fleet-wide landing template (scripts/landing/template). Its
// own contract — sections, badge, theme, FAQ — is asserted by the generated
// tests/landing.spec.ts; what stays here is what is specific to mero-pass.
test.describe("unauthenticated entry", () => {
  test("the entry route renders and offers a way to connect", async ({ page }) => {
    await page.goto("/");
    // A BUTTON, not a link, and there is no second page behind it. The CTA
    // used to navigate to /login, where mero-react's ConnectButton lived; it
    // now opens the connection popup over this page. What matters is unchanged
    // — that a real way in is offered from `/`.
    await expect(
      page.getByRole("button", { name: "Connect to node" }).first(),
    ).toBeVisible();
  });

  test("the page identifies itself as Mero Pass", async ({ page }) => {
    await page.goto("/");
    // The package id is `com.calimero.mero-pass` and the registry still lists
    // this bundle as `MeroPass` — neither is touched. The DISPLAY name is
    // spelled with a space everywhere a person reads it, and the <title> is
    // one of those places, so `/meropass/i` would no longer match.
    await expect(page).toHaveTitle(/Mero Pass/);
    // The brand in the navbar, not just the tab — a blank shell would still
    // have the right title. Same spelling in both, which is the point: the
    // landing page and the app shell no longer disagree about the name.
    await expect(page.locator(".cal-lp-brand")).toHaveText(/Mero Pass/);
  });

  test("an unknown route does not render a blank page", async ({ page }) => {
    // There is no catch-all route, so this asserts the app shell still mounts
    // rather than the bundle failing to boot.
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("#root")).toBeAttached();
  });
});
