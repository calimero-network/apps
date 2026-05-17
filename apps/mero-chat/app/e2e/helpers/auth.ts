import type { Page } from "@playwright/test";

/**
 * Simulate mero-react authentication by injecting tokens directly into
 * localStorage — the same `mero-tokens` blob format MeroProvider's internal
 * `LocalStorageTokenStore()` reads from.
 *
 * Use this helper in tests that want to skip the actual auth redirect and
 * start with an already-authenticated session.
 */
export async function injectMeroAuthTokens(
  page: Page,
  opts: { nodeUrl: string; accessToken: string; refreshToken?: string },
) {
  await page.addInitScript(
    ({ nodeUrl, accessToken, refreshToken }) => {
      localStorage.setItem("mero:node_url", nodeUrl);
      localStorage.setItem(
        "mero-tokens",
        JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken ?? "",
          expires_at: Date.now() + 3600_000,
        }),
      );
    },
    opts,
  );
}

/**
 * Clear all auth-related localStorage keys.
 */
const AUTH_KEYS = ["mero:node_url", "mero-tokens"] as const;

export async function clearAuth(page: Page) {
  await page.evaluate((keys) => {
    keys.forEach((k) => localStorage.removeItem(k));
  }, AUTH_KEYS as unknown as string[]);
}
