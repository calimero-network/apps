import { expect, test, type Page } from '@playwright/test';

// Log out, from the rail's identity block, the phone drawer, or Security →
// Your account. Each ends the session (mero-react's token store and `mero:*`
// keys), lands on the front door with no way Back into the app, and keeps the
// browser's own light/dark choice.
//
// No node needed: a session arrives the way the desktop hands one over, in
// the URL fragment, which mero-react adopts and stores before any request is
// made. What happens to the VAULT keys on log out (locked, and a copied
// password wiped from the clipboard) is asserted against a real node in
// e2e/journey/session.journey.ts, and in src/auth/signOut.test.ts.

const NODE = 'http://127.0.0.1:9';

async function signIn(page: Page) {
  const expires = Date.now() + 60 * 60 * 1000;
  await page.goto(
    `/teams#node_url=${encodeURIComponent(NODE)}&access_token=test-access&refresh_token=test-refresh&expires_at=${expires}`,
  );
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  // mero-react took the session out of the fragment and stored it.
  await expect
    .poll(() => sessionKeys(page).then((k) => k.length))
    .toBeGreaterThan(0);
}

/** Every key mero-react keeps a session under. */
function sessionKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter(
      (k) => k === 'mero-tokens' || k.startsWith('mero:'),
    ),
  );
}

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
