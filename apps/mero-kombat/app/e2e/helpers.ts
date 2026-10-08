import { expect, type Page } from "@playwright/test";
import { readState } from "./global-setup";

export const state = () => readState();

/**
 * Hand the app a session the way the auth frontend does — tokens in the URL
 * fragment — instead of driving the login modal.
 *
 * ⚠️ `mero:node_url` has to be seeded first. mero-react will not adopt a
 * callback bundle unless it can trust the node, and its rule needs either a
 * node THIS browser context initiated a login against, or `allowedNodeUrls`.
 * A fresh Playwright context has neither, so without this the provider logs
 * "OAuth callback node_url is not trusted" and silently drops the tokens.
 * Seeding it is what an in-app login would have done at `connectToNode`.
 *
 * Everything after that is the real path: the provider parses the fragment,
 * runs `resolveTokenAdoption`, stores the bundle and clears the URL itself.
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
  // Omitted when the spec wants to land on the table picker instead.
  if (opts.withContext !== false) params.set("context_id", s.contextId);

  // `/play` rather than `/`: the landing page is the front door for a stranger,
  // and a spec about the arena should not spend its first assertion proving the
  // marketing copy redirects. `marketing-landing.spec.ts` covers that route.
  await page.goto(`/play#${params.toString()}`);
}

/** The arena, once the first `arena()` read has landed. */
export async function waitForArena(page: Page) {
  await expect(page.locator("canvas.arena-canvas")).toBeVisible({ timeout: 30_000 });
}

/** The status pill above the cabinet. */
export function status(page: Page) {
  return page.getByTestId("status");
}

export const btn = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/**
 * Fail a spec on any console error or failed request.
 *
 * The point of driving a real node is catching the failures that never surface
 * as a wrong pixel: an unhandled rejection, a 4xx from the admin API, a React
 * warning about a bad update. A green assertion over a page that logged a
 * TypeError is not a passing test.
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
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "?";
    // `net::ERR_ABORTED` is a request the PAGE cancelled, not one that failed.
    // mero-react probes `/auth/validate` on every provider render and aborts
    // the in-flight probe when the session resolves or the component unmounts,
    // so a clean run reports several of these — treating them as errors makes
    // this watcher fail every spec that logs in, which is all of them.
    if (reason.includes("ERR_ABORTED")) return;
    errors.push(`requestfailed: ${r.method()} ${r.url()} — ${reason}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return {
    errors,
    assertClean() {
      expect(errors, `page reported ${errors.length} error(s):\n  ${errors.join("\n  ")}`).toEqual(
        [],
      );
    },
  };
}
