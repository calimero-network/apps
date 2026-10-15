import { expect, type Page } from "@playwright/test";

/**
 * Opening an invitation the way a person does: by following the link.
 *
 * Nobody pastes. A shared link is `https://links.calimero.network/<slug>/join?invitation=…`,
 * and it reaches the app by one of two routes, both of which this module drives:
 *
 *   - `url`: the links page (or the desktop launcher on a cold start) opens the app's own
 *     frontend with the link's query string appended, `/?invitation=…`. That is a page load.
 *   - `desktop`: the app is already open inside the desktop launcher (Tauri), and the
 *     launcher hands it the link as a `deep-link` event on `window.__calimero_platform__`.
 *     No navigation happens; the open app has to notice.
 *
 * Either way the app shows its invitation prompt, and the person clicks
 * `data-testid="invite-accept"`. That test id is the contract every app's prompt keeps.
 */
export type InviteRoute = "url" | "desktop";

/** The slug and query a shared link carries, whatever form it was copied in. */
export function parseInviteLink(link: string): { slug: string | null; query: string } {
  const text = link.trim();
  const custom = /^calimero:\/\/([^/?#]+)\/[^?#]*(\?[^#]*)?/i.exec(text);
  if (custom) return { slug: custom[1] ?? null, query: custom[2] ?? "" };
  const url = new URL(text);
  const [slug] = url.pathname.replace(/^\/+/, "").split("/");
  return { slug: url.host === "links.calimero.network" && slug ? slug : null, query: url.search };
}

/**
 * Stand in for the desktop launcher's bridge. Installed before any app script runs, as the
 * launcher's own injection is, so the app's capture subscribes to it on boot.
 */
export async function installDesktopBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    const w = window as unknown as Record<string, unknown>;
    w["__calimero_platform__"] = {
      version: 1,
      capabilities: ["deepLink"],
      // Everything a launcher could be asked for answers "nothing to report": the
      // invitation path calls no native method, and a rejection would be an error the
      // app has to survive rather than the behaviour under test.
      invoke: async () => null,
      on(event: string, handler: (payload: unknown) => void) {
        let set = handlers.get(event);
        if (!set) handlers.set(event, (set = new Set()));
        set.add(handler);
        return () => set!.delete(handler);
      },
    };
    w["__e2eDeepLink__"] = (raw: string) => {
      const set = handlers.get("deep-link");
      for (const handler of set ?? []) handler({ raw });
      return set?.size ?? 0;
    };
  });
}

/** Open `link` in `page` by the given route. */
export async function openInviteLink(page: Page, link: string, route: InviteRoute = "url"): Promise<void> {
  const { slug, query } = parseInviteLink(link);
  if (!query.includes("invitation=")) throw new Error(`not an invitation link: ${link.slice(0, 120)}`);

  if (route === "url") {
    await page.goto(`/${query}`);
    return;
  }

  const raw = `calimero://${slug ?? "app"}/join${query}`;
  await expect
    .poll(
      () =>
        page.evaluate((r) => {
          const fire = (window as unknown as { __e2eDeepLink__?: (raw: string) => number }).__e2eDeepLink__;
          return fire ? fire(r) : -1;
        }, raw),
      { message: "the app subscribes to the desktop bridge's deep-link event", timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

/** Click the app's invitation prompt through. */
export async function acceptInvitePrompt(page: Page, timeout = 60_000): Promise<void> {
  const accept = page.getByTestId("invite-accept");
  await expect(accept, "the app shows its invitation prompt").toBeVisible({ timeout });
  await accept.click();
}
