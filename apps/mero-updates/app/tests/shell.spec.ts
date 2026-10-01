import { expect, test } from "@playwright/test";

/**
 * The app shell with no node attached — a cold CI run and a first visitor.
 *
 * What it defends is the gate: an explainer at `/`, and every contract-backed
 * route redirecting to the front door rather than rendering into failure. With
 * no node, `useUpdatesClient()` is null and every read would throw — a page
 * that merely does not blank is not a page that works.
 *
 * The landing page's own contract (sections, badge, theme, FAQ) is asserted by
 * the generated tests/marketing-landing.spec.ts. What stays here is what is
 * specific to Mero Updates.
 */
test.describe("app shell", () => {
  test("`/` is the explainer, not the updates feed", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What you can do" })).toBeVisible();

    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "What this is" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();

    // The composer and the feed need a node; neither may render without one.
    await page.goto("/");
    await expect(page.getByTestId("composer")).toHaveCount(0);
    await expect(page.getByTestId("team-panel")).toHaveCount(0);

    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  for (const path of ["/a", "/a/compose?template=monthly", "/a/p/deadbeef", "/a/asks", "/a/settings", "/companies"]) {
    test(`${path} redirects to the front door instead of failing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 1, name: "Mero Updates" })).toBeVisible();
      expect(errors, "an unhandled error escaped to the page").toEqual([]);
    });
  }

  test("an unknown route and the old /spaces path fall back safely", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/spaces");
    await expect(page).toHaveURL(/\/$/);
  });

  test("/login is a redirect, not a second sign-in page", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("button").filter({ hasText: /^Connect to node$/ }).first()).toBeVisible();
  });
});
