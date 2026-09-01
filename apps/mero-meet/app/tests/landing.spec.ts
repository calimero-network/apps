import { expect, test } from "@playwright/test";

// Smoke coverage for the plain-web entry — the state a first visitor and a cold
// CI run are both in: no Tauri shell, no dev-session hash.
//
// Mero Meet blocks the web ON PURPOSE (App.tsx short-circuits on `!APP_ENABLED`;
// media, node and SSO all come from the desktop shell), so unlike the other apps
// the correct behaviour here is the landing page, not a login. What these tests
// defend is that the block still renders a real page with a way forward. The
// failure they exist to catch is the one this app already shipped once: every
// unauthenticated state answered with a page that told the user to install the
// app they had just opened it from, offering nothing to click.
test.describe("plain-web entry", () => {
  test("/ renders the desktop-required landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/desktop app required/i)).toBeVisible();
  });

  test("the landing page offers a real way forward, not just a wall", async ({ page }) => {
    await page.goto("/");
    // The download CTA is the assertion that matters: it is the difference
    // between a block and a dead end.
    const cta = page.getByRole("link", { name: /get calimero desktop/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /calimero\.network\/download/);
  });

  test("an in-app route does not render blank on the web", async ({ page }) => {
    // `/lobby` never reaches the router on the web — App.tsx returns the landing
    // page before <Routes> mounts. Asserted because the alternative failure mode
    // is a white screen on a shared deep link, which looks like an outage.
    await page.goto("/lobby");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/desktop app required/i)).toBeVisible();
  });
});
