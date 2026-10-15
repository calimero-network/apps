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

/**
 * Accept the app's invitation dialog (mero-react `InvitationDialog`) and see it
 * through: joining, syncing, and closing by itself once the joined namespace's
 * data has reached this node.
 *
 * The close is the point. The dialog holds "Syncing…" until the page that reads
 * the namespace clears its just-joined flag (`useJoinSync({ settled })`), and
 * otherwise only lets go at its 2-minute ceiling. Waiting well under that
 * ceiling makes an app whose page never reports its data fail here, rather than
 * leave a real person staring at a spinner.
 */
export async function acceptInvitePrompt(page: Page, timeout = 60_000): Promise<void> {
  const prompt = page.getByTestId("invite-prompt");
  const accept = page.getByTestId("invite-accept");
  await expect(accept, "the app shows its invitation dialog").toBeVisible({ timeout });

  // Every stage the dialog passes through, however briefly it shows. Sent to
  // the test as it happens, and the observer is reinstalled on every load: an
  // app may enter the joined namespace with a full page load right after the
  // dialog closes (mero-chat does), which would wipe anything kept in the page.
  const stages: string[] = [];
  const binding = `__inviteStage_${Math.random().toString(36).slice(2)}`;
  await page.exposeFunction(binding, (stage: string) => {
    if (stages[stages.length - 1] !== stage) stages.push(stage);
  });
  const observe = (name: string) => {
    const send = (window as unknown as Record<string, ((stage: string) => void) | undefined>)[
      name
    ];
    if (!send) return;
    const read = () =>
      send(
        document.querySelector('[data-testid="invite-prompt"]')?.getAttribute("data-stage") ??
          "closed",
      );
    read();
    // `document`, not `documentElement`: on a fresh load the init script runs
    // before the root element exists.
    new MutationObserver(read).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-stage"],
    });
  };
  await page.addInitScript(observe, binding);
  await page.evaluate(observe, binding);
  await accept.click();

  await expect(
    prompt,
    "the invitation dialog closes by itself once the joined namespace's data has arrived",
  ).toBeHidden({ timeout: 90_000 });

  // The last reports cross from the page asynchronously; give them a moment.
  await expect
    .poll(() => stages, { message: "the dialog joined, then reported the join done", timeout: 5_000 })
    .toEqual(expect.arrayContaining(["joining", "ready"]));
  expect(stages, "the dialog never failed").not.toContain("failed");
}
