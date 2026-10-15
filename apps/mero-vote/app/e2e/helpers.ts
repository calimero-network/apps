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
export async function login(page: Page, opts: { withContext?: boolean; contextId?: string } = {}) {
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
  // Omitted when the spec wants to land on the context picker instead.
  if (opts.withContext !== false) params.set("context_id", opts.contextId ?? s.contextId);

  await page.goto(`/#${params.toString()}`);
  await expect(page.getByRole("heading", { name: "Mero Vote" })).toBeVisible();
}

/**
 * A new context of the same application and namespace, through the admin API.
 *
 * For a spec that needs state no other spec has touched: the setup context is
 * shared by every spec, so once one of them joins the roster there is no
 * "first-time user" left in it.
 */
export async function freshContext(): Promise<string> {
  const s = state();
  const resp = await fetch(`${s.nodeUrl}/admin-api/contexts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessToken}` },
    body: JSON.stringify({ applicationId: s.applicationId, groupId: s.namespaceId, initializationParams: [] }),
  });
  if (!resp.ok) throw new Error(`create context -> ${resp.status}: ${await resp.text()}`);
  const body = await resp.json();
  return ((body.data ?? body) as { contextId: string }).contextId;
}

/** Wait until the vote panel is interactive (a context is open). */
export async function waitForPanel(page: Page) {
  await expect(page.getByRole("heading", { name: "Polls", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The card whose <h2> is `heading`. */
export function card(page: Page, heading: string | RegExp) {
  return page.locator(".card", {
    has: page.getByRole("heading", { name: heading, exact: typeof heading === "string" }),
  });
}

export const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

export function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}`;
}

/**
 * Fail a spec on any console error or failed request.
 *
 * The point of driving a real node is catching the failures that never surface
 * as a wrong pixel: an unhandled rejection, a 4xx from the admin API, a React
 * warning about a bad update. A green assertion over a page that logged a
 * TypeError is not a passing test.
 *
 * Returns an assert function so a spec can check at the point it cares about.
 */
export function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // React's dev overlay re-logs a thrown error that the app already surfaced
    // in its own error UI; the spec asserting that UI is the real check.
    if (/Failed to load resource/.test(text)) return;
    errors.push(`console.error: ${text.slice(0, 400)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "?";
    // mero-react probes `HEAD /auth/validate` and cancels the probe still in
    // flight once the session resolves or the provider unmounts. The page
    // cancelled it; nothing failed. Any other cancelled request still counts.
    const probe = r.method() === "HEAD" && new URL(r.url()).pathname === "/auth/validate";
    if (probe && reason.includes("ERR_ABORTED")) return;
    errors.push(`requestfailed: ${r.method()} ${r.url()} — ${reason}`);
  });
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
