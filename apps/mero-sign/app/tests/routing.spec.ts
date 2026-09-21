import { expect, test } from "@playwright/test";

// ── The redirect loop, asserted against a running app ────────────────────────
//
// Reported as "we do /landing it starts throwing /~&~&~&/// all the time, some
// recursive error". Reproduced against the live deployment: 864 navigations in
// six seconds, the URL growing without bound —
//
//   /landing → /landing/?/ → /landing/?/&/ → /landing/?/&/~and~/ → …
//
// The cause is a GitHub Pages SPA shim (`spa-github-pages`, with
// `pathSegmentsToKeep = 1`) served as `404.html` by a very old deployment. The
// unit tests in `src/routes.test.ts` assert that shim cannot ship from here.
// These assert the other half: that the app itself, running, never moves the
// URL on its own — on the path that was reported, and on the shapes a redirect
// loop hides in.
//
// A loop is exactly the bug that looks fixed until somebody tries the one path
// you did not, so this walks several rather than one.

const PATHS = [
  "/landing",
  "/",
  "/docs",
  "/preview",
  "/workspaces",
  "/agreements",
  "/signatures",
  "/nope",
  "/a/b/c/d",
  "/landing/extra",
];

test.describe("routing never redirects", () => {
  for (const path of PATHS) {
    test(`${path} settles where it was opened`, async ({ page }) => {
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await page.goto(path, { waitUntil: "load" });
      // Long enough for a mount-time redirect to fire, which is when one would.
      await page.waitForTimeout(1500);

      expect(new URL(page.url()).pathname).toBe(path);
      expect(new URL(page.url()).search).toBe("");
      // ⚠️ DISTINCT urls, not a count. A single `goto` produces more than one
      // `framenavigated` (the blank document, then the real one), so counting
      // events asserts a property of the browser rather than of the app. What
      // matters is that the app never moved the URL to a DIFFERENT one.
      const distinct = new Set(
        navigations.map((u) => new URL(u).pathname + new URL(u).search),
      );
      expect([...distinct]).toEqual([path]);
      expect(errors).toEqual([]);
    });
  }

  test("the loop's own shape does not grow", async ({ page }) => {
    // The exact URL the shim produced on its first bounce. Whatever this app
    // decides to render for it, it must not add another segment.
    const seeded = "/landing/?/&/~and~/";
    await page.goto(seeded, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    expect(page.url()).not.toContain("~and~/~and~");
  });

  test("a query string is left alone rather than re-encoded", async ({ page }) => {
    // `&` → `~and~` is the shim's signature. Nothing in the app should ever do
    // that to a URL.
    await page.goto("/docs?a=1&b=2", { waitUntil: "load" });
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("a=1&b=2");
    expect(page.url()).not.toContain("~and~");
  });

  test("an unknown path renders a dead end with a way out", async ({ page }) => {
    await page.goto("/nope", { waitUntil: "load" });
    await expect(page.getByTestId("not-found")).toBeVisible();
    // It offers links. A screen with no way out is how somebody ends up
    // reloading a broken URL forever.
    await expect(page.getByRole("link", { name: "Your agreements" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/nope");
  });

  test("/landing is a real page, not a fallback", async ({ page }) => {
    await page.goto("/landing", { waitUntil: "load" });
    await expect(page.getByRole("heading", { level: 1, name: "Mero Sign" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/landing");
  });

  test("a signed-out visitor keeps the app URL they asked for", async ({ page }) => {
    // Rendered, not redirected — so signing in lands them on the page they
    // opened rather than on the home screen.
    await page.goto("/agreements", { waitUntil: "load" });
    await expect(page.getByTestId("connect-cta")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/agreements");
  });
});
