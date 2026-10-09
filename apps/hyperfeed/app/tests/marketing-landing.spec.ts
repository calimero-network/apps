/**
 * Hyperfeed's own landing and docs pages, signed out, with no node.
 *
 * Hand-owned: Hyperfeed left the shared landing template (scripts/landing), so
 * this spec, not the generator, is the page's contract.
 */
import { test, expect, type Page } from "@playwright/test";

const SECTIONS = ["lanes", "rules", "start"];
const DOC_SECTIONS = ["concepts", "start", "using", "agent", "storage", "trouble"];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

test.describe("Hyperfeed landing page", () => {
  test("pitches the feed and draws it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything your agent does. One feed.");
    for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toBeVisible();
    // The hero is the app as drawn: the lanes, the agent, a permission waiting on you.
    const hero = page.getByRole("img", { name: /The Hyperfeed app/ });
    await expect(hero).toBeVisible();
    await expect(hero.getByText("Agent live")).toBeVisible();
    await expect(hero.getByText("Bash: Render the album cover")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Open your feed opens the connect dialog", async ({ page }) => {
    await page.goto("/");
    const before = page.url();
    await page.getByRole("button", { name: "Open your feed" }).first().click();
    // mero-react's LoginModal, over the page rather than a route away from it.
    await expect(page.getByText("Connect to Calimero")).toBeVisible();
    await expect(page).toHaveURL(before);
  });

  test("the demo is one click away", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Try the demo, no node needed" }).click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole("region", { name: "To do" })).toBeVisible();
  });

  test("the theme switch reaches the whole app", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const ground = await page.locator(".hl").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ground).toBe("rgb(0, 0, 0)");
  });

  test("docs explain every part, and /preview lands on the overview", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { level: 1, name: "How Hyperfeed works" })).toBeVisible();
    for (const id of DOC_SECTIONS) await expect(page.locator(`section#${id}`)).toBeVisible();
    await page.goto("/preview");
    await expect(page).toHaveURL(/\/$/);
  });

  for (const width of [390, 320]) {
    test(`fits a ${width}px phone`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/docs"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noSideScroll(page);
      }
    });
  }
});
