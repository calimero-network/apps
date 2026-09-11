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
    // The landing's CTA is a link to /login, where mero-react's ConnectButton
    // lives. What matters is that a real destination is offered from `/` and
    // that the connect affordance is actually there when you arrive.
    await expect(
      page.getByRole("link", { name: "Connect to node" }).first(),
    ).toBeVisible();
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /connect a node/i })).toBeVisible();
  });

  test("the page identifies itself as MeroPass", async ({ page }) => {
    await page.goto("/");
    // The package is `com.calimero.mero-pass`, but the <title> is the DISPLAY
    // name and stays "MeroPass" — the mero- rename moved identifiers, not
    // product names. `/meropass/i` matches "MeroPass"; `/mero-pass/i` does not.
    await expect(page).toHaveTitle(/meropass/i);
    // The brand in the navbar, not just the tab — a blank shell would still
    // have the right title. The landing page spells the product name with a
    // space ("Mero Pass"); the package id and the <title> are unchanged, which
    // is the whole point of the presentation-only displayName override.
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
