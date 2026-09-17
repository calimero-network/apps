import { expect, test } from "@playwright/test";

// What this asserts is the half of the invitation flow that can be observed
// without a node: an invitation link, opened by somebody who is NOT logged in,
// is captured and kept.
//
// That is where the old implementation lost it. `?invitation=` was read only
// once `isAuthenticated` was true, and it was not written to storage until the
// join popup mounted — which is after login. So a signed-out visitor opening a
// link went through the auth redirect with the invitation living nowhere but
// the URL they were redirected away from, and arrived logged in with nothing.
//
// Capture now happens in main.tsx at module scope, before React mounts, and the
// platform's PendingIntentStore persists it. The redemption itself needs a node
// and is exercised by the unit tests around the codec and by hand.

const PENDING_INTENTS = "calimero.platform.pendingIntents";

// Shape does not matter here — capture is upstream of decoding, and a code this
// app cannot redeem must still be captured rather than silently dropped.
const CODE = "3vQB7B6MrGQZaxCuFg4ohTestInvitationPayloadValue";

test.describe("invitation links", () => {
  test("an invitation survives arriving signed out", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`/?invitation=${CODE}`);
    await expect(page.getByRole("heading", { level: 1, name: "Mero Sign" })).toBeVisible();

    // Stripped from the address bar: an invitation is a signed capability and
    // one sitting in a URL gets screenshotted and pasted into bug reports.
    await expect.poll(() => new URL(page.url()).searchParams.get("invitation")).toBeNull();

    // …but kept, so it is still there after the login redirect.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      PENDING_INTENTS,
    );
    expect(stored).toContain(CODE);

    expect(errors).toEqual([]);
  });

  test("a link may land on any route, not just `/`", async ({ page }) => {
    // The prompt mounts at app level, so the route an invitation arrives on is
    // not something the sender has to get right.
    await page.goto(`/docs?invitation=${CODE}`);
    await expect(page.getByRole("heading", { name: "What this is" })).toBeVisible();

    await expect.poll(() => new URL(page.url()).searchParams.get("invitation")).toBeNull();
    expect(new URL(page.url()).pathname).toBe("/docs");

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      PENDING_INTENTS,
    );
    expect(stored).toContain(CODE);
  });

  test("the SSO fragment is not thrown away to accept an invitation", async ({ page }) => {
    // The desktop hand-off carries the session in the fragment. The previous
    // strip was `replaceState({}, title, location.pathname)`, which dropped it —
    // opening an invitation link signed you out.
    await page.goto(`/?invitation=${CODE}#access_token=abc&node_url=http%3A%2F%2Flocalhost%3A2528`);
    await expect(page.getByRole("heading", { level: 1, name: "Mero Sign" })).toBeVisible();

    await expect.poll(() => new URL(page.url()).searchParams.get("invitation")).toBeNull();
    expect(page.url()).toContain("#access_token=abc");
  });
});
