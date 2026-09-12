import { expect, test } from "@playwright/test";

/**
 * The app shell with no node attached — a cold CI run and a first visitor.
 *
 * ⚠️ REWRITTEN, and the previous version is why. It asserted that `/` renders
 * the FEED unauthenticated:
 *
 *     await page.goto("/");
 *     await expect(page.getByRole("tab", { name: "New" })).toBeVisible();
 *     await expect(page.getByLabel("Start a discussion")).toBeVisible();
 *
 * which is precisely the behaviour that produced the reported FunctionCallError:
 * with no node, `useForumClient()` is null, every read fails and the composer's
 * only possible outcome is a throw. The test was green because the page did not
 * BLANK — it never checked that anything on it could work. So it locked in the
 * bug it was standing next to.
 *
 * What it defends now is the gate: an explainer at `/`, and the contract-backed
 * routes redirecting to the connect screen rather than rendering into failure.
 * The composer's validation moved to a unit test (src/components/Composer.test.tsx)
 * — it is pure UI logic and no longer reachable unauthenticated.
 *
 * ⚠️ The explainer at `/` is now the fleet-wide landing template
 * (scripts/landing/template), so its own contract — sections, badge, theme, FAQ
 * — is asserted by the generated tests/landing.spec.ts. What stays here is what
 * is specific to mero-forum: the gate, and that `/` still is not the feed.
 */
test.describe("app shell", () => {
  test("`/` is the explainer, and it does not pretend to be the feed", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Mero Forum" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();

    // ⚠️ The explainer, the four steps and the FAQ now live on `/docs`. The
    // landing is three pages: `/` sells it, `/docs` explains it, `/preview`
    // shows it. Asserting them all on `/` was asserting the old shape.
    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "What this is" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How Calimero works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
    await page.goto("/");

    // The thing the old test asserted must NOT be here: a composer with no node
    // behind it can only throw.
    await expect(page.getByLabel("Start a discussion")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "New" })).toHaveCount(0);

    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("every section of the explainer is visible without scrolling", async ({ page }) => {
    // Regression guard. The first version of this page parked three sections at
    // `opacity: 0.001` behind an IntersectionObserver, so Features, How it works
    // and FAQ rendered as empty bands for anyone who did not scroll — and in
    // every link preview and thumbnail.
    await page.goto("/");
    const faint = await page.evaluate(() =>
      [...document.querySelectorAll("section, h2, h3, li")]
        .filter(
          (el) =>
            parseFloat(getComputedStyle(el).opacity) < 0.9 &&
            (el.textContent ?? "").trim().length > 10,
        )
        .map((el) => `${el.tagName}: ${(el.textContent ?? "").trim().slice(0, 40)}`),
    );
    expect(faint, "content parked below full opacity at rest").toEqual([]);
  });

  // ⚠️ These used to expect `/login`. That page is gone across the fleet — its
  // whole content was a button the visitor had already pressed to get there —
  // so a signed-out visitor is sent to the front door, which is where the way
  // in now lives.
  test("the feed redirects to the front door instead of failing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/f");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mero Forum" })).toBeVisible();
    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("a post permalink redirects too, rather than rendering a dead shell", async ({ page }) => {
    await page.goto("/p/deadbeef");
    await expect(page).toHaveURL(/\/$/);
  });

  test("an unknown route falls back to the explainer", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mero Forum" })).toBeVisible();
  });

  test("/login is a redirect now, not a second sign-in page", async ({ page }) => {
    // The node-discovery modal it used to render is opened from the landing
    // page's own CTA. The path stays so a bookmark is not a blank route.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator("button").filter({ hasText: /^Connect to node$/ }).first(),
    ).toBeVisible();
  });
});
