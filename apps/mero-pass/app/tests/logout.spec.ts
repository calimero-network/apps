import { expect, test, type Page } from '@playwright/test';

import { sessionKeys, signIn } from './session';

// Log out, from the rail's identity block, the phone drawer, or Security →
// Your account. Each ends the session (mero-react's token store and `mero:*`
// keys), lands on the front door with no way Back into the app, and keeps the
// browser's own light/dark choice.
//
// No node needed: tests/session.ts signs in the way the desktop hands a
// session over, in the URL fragment, and stubs the node's token check. What
// happens to the VAULT keys on log out (locked, and a copied
// password wiped from the clipboard) is asserted against a real node in
// e2e/journey/session.journey.ts, and in src/auth/signOut.test.ts.

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('landing')).toBeVisible();
  expect(
    (await sessionKeys(page)).filter(
      (k) => k === 'mero-tokens' || /token/.test(k),
    ),
  ).toEqual([]);
  // Still signed out after a reload: nothing re-adopts the session.
  await page.reload();
  await expect(page.getByTestId('landing')).toBeVisible();
  expect(
    (await sessionKeys(page)).filter(
      (k) => k === 'mero-tokens' || /token/.test(k),
    ),
  ).toEqual([]);
}

test.describe('log out', () => {
  test('the rail shows who is signed in, and its Log out ends the session', async ({
    page,
  }) => {
    await signIn(page);
    const logout = page.getByTestId('logout');
    await expect(logout).toBeVisible();
    await expect(logout).toHaveText(/Log out/);
    await logout.click();
    await expectSignedOut(page);
  });

  test('on a phone, Log out is in the navigation drawer the top bar opens', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    // No rail on a phone: its contents live behind the menu button.
    await expect(page.getByTestId('logout')).toHaveCount(0);
    await page.getByTestId('mobile-nav-btn').click();
    const drawer = page.getByTestId('mobile-nav');
    await expect(drawer).toBeVisible();
    // The drawer covers the whole viewport, top bar included.
    const cover = await page.evaluate(() => {
      const r = document
        .querySelector('[data-testid="mobile-nav"]')!
        .parentElement!.getBoundingClientRect();
      return {
        box: [r.top, r.left, r.width, r.height],
        viewport: [0, 0, window.innerWidth, window.innerHeight],
      };
    });
    expect(cover.box).toEqual(cover.viewport);
    // Going somewhere closes it.
    await drawer.getByTestId('security').click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(drawer).toHaveCount(0);

    await page.getByTestId('mobile-nav-btn').click();
    await page.getByTestId('mobile-nav').getByTestId('logout').click();
    await expectSignedOut(page);
  });

  test('Security → Your account → Log out does the same, and keeps the theme choice', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByTestId('security').click();
    await page.getByTestId('appearance-dark').click();
    await page.getByTestId('settings-logout').click();
    await expectSignedOut(page);
    expect(
      await page.evaluate(() => localStorage.getItem('mero-pass:theme')),
    ).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

// ── Back after Log out ──────────────────────────────────────────────────────
//
// ⚠️ THE BUG THIS CATCHES. The in-app routes had no sign-in guard, so after
// Log out the browser's Back button returned to the previous in-app page and
// rendered the app frame — rail, top bar, Log out — around no data, for nobody.
// Every in-app route now waits for mero-react to know whether there is a
// session, and sends a signed-out visitor to the front door.
test.describe('signed out, the app frame is unreachable', () => {
  test('Back after Log out lands on the front door, not an empty app', async ({
    page,
  }) => {
    await signIn(page);
    // Somewhere else in the app first, so there is an in-app page behind the
    // one Log out replaces.
    await page.getByTestId('security').click();
    await expect(page).toHaveURL(/\/security$/);
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('landing')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('landing')).toBeVisible();
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.getByTestId('logout')).toHaveCount(0);
  });

  for (const path of ['/teams', '/teams/ns-1', '/vault/ctx-1', '/security']) {
    test(`opening ${path} with no session lands on the front door`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('landing')).toBeVisible();
      await expect(page.getByTestId('theme-toggle')).toHaveCount(0);
    });
  }

  test('signed in, a reload on a deep route stays there', async ({ page }) => {
    await signIn(page, '/vault/ctx-1');
    await expect(page).toHaveURL(/\/vault\/ctx-1$/);
    await page.reload();
    // The guard waits out mero-react's session restore instead of bouncing.
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    await expect(page).toHaveURL(/\/vault\/ctx-1$/);
    await expect(page.getByTestId('landing')).toHaveCount(0);
  });
});
