import { expect, type Page } from '@playwright/test';

// A signed-in session without a node.
//
// A session arrives the way the desktop hands one over, in the URL fragment;
// mero-react adopts and stores it before any request is made. It then asks the
// node whether the token is still good (`HEAD /auth/validate`) and only says
// `isAuthenticated` when the node answers 200 — so that one answer is stubbed
// here, and nothing else. Every other request to the fake node fails, which is
// what the pages already do when a node is unreachable.
//
// The stub is what lets the app's sign-in guard be tested at all: without it
// mero-react reports a stored-but-unvalidated session as signed OUT, and every
// in-app route sends the visitor back to the front door.

export const NODE = 'http://127.0.0.1:9';

/** Answer the node's token check the way a live node does for a good token. */
export async function stubNodeAuth(page: Page) {
  await page.route(`${NODE}/auth/validate`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      },
    }),
  );
}

/** Every key mero-react keeps a session under. */
export function sessionKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter(
      (k) => k === 'mero-tokens' || k.startsWith('mero:'),
    ),
  );
}

/** Sign in at `path` (default `/teams`) and wait for the app frame. */
export async function signIn(page: Page, path = '/teams') {
  await stubNodeAuth(page);
  const expires = Date.now() + 60 * 60 * 1000;
  await page.goto(
    `${path}#node_url=${encodeURIComponent(NODE)}&access_token=test-access&refresh_token=test-refresh&expires_at=${expires}`,
  );
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  // mero-react took the session out of the fragment and stored it.
  await expect
    .poll(() => sessionKeys(page).then((k) => k.length))
    .toBeGreaterThan(0);
}
