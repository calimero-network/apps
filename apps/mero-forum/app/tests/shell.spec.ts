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
 */
test.describe("app shell", () => {
  test("`/` is the explainer, and it does not pretend to be the feed", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /a forum that lives on your nodes/i }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();

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

  test("the feed redirects to the connect screen instead of failing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/f");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /connect your node/i })).toBeVisible();
    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("a post permalink redirects too, rather than rendering a dead shell", async ({ page }) => {
    await page.goto("/p/deadbeef");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an unknown route falls back to the explainer", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: /a forum that lives on your nodes/i }),
    ).toBeVisible();
  });

  test("the connect screen offers the shared ConnectButton", async ({ page }) => {
    await page.goto("/login");
    // mero-react's ConnectButton — the same control every app in the fleet uses,
    // which owns the node-discovery modal.
    await expect(page.getByRole("button", { name: /connect a node/i })).toBeVisible();
  });
});
