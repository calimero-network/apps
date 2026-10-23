import { expect, type Page } from "@playwright/test";
import { openAuthCallback } from "@calimero-apps/e2e-node/journey";
import { readState } from "./global-setup";

export const state = () => readState();

/**
 * Hand the app a session the way the auth frontend does — tokens in the URL
 * fragment — instead of driving the login modal.
 *
 * ⚠️ `mero:node_url` has to be seeded first. mero-react only adopts a callback
 * bundle from a node THIS browser context initiated a login against (or one in
 * `allowedNodeUrls`); a fresh Playwright context has neither, and the provider
 * would silently drop the tokens. Everything after that is the real path.
 */
export async function login(page: Page, opts: { withContext?: boolean } = {}) {
  const s = state();
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ["mero:node_url", s.nodeUrl] as const,
  );

  const params = new URLSearchParams({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    node_url: s.nodeUrl,
    application_id: s.applicationId,
  });
  if (opts.withContext !== false) params.set("context_id", s.contextId);

  await openAuthCallback(page, "/", params);
  await expect(page.locator(".brand-name")).toBeVisible();
}

/** Wait until the team view is up and knows who we are. */
export async function waitForTeam(page: Page) {
  await expect(page.getByTestId("my-name")).toBeVisible({ timeout: 30_000 });
}

export const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** A text field by its exact accessible name ("next" must not match "next day"). */
export const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Fail a spec on any console error or failed request. A green assertion over
 * a page that logged a TypeError or got a 4xx from the node is not a pass.
 */
export function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource/.test(text)) return;
    errors.push(`console.error: ${text.slice(0, 400)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return {
    errors,
    assertClean() {
      expect(errors, `page reported ${errors.length} error(s):\n  ${errors.join("\n  ")}`).toEqual([]);
    },
  };
}
