import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";

/**
 * IMPORTANT.md item 10 — "Comments are overlaying the navbar dropdowns, e.g. i have
 * options dropdown and comments are on top of it instead of behind it".
 *
 * Not a z-index value: the navbar root (`.bar`) created a stacking context at
 * `z-index: 10`, so the dropdowns inside it composited at 10 no matter that they
 * declare 200, while the comments overlay is a sibling at 100.
 *
 * The assertions sample **the centre of each pin**, not the centre of each menu
 * item. That distinction is the whole spec: the dropdown is 200px wide and a pin is
 * 20px, so an item's centre almost never lies under a pin — sampling there passes
 * with the bug fully present, which is how the first version of this spec was
 * vacuous. Verified in both directions: green with the fix, red with z-index 10.
 */

/**
 * Pins placed to overlap the Options dropdown, which opens at roughly
 * x 474-674, y 41-389. The canvas viewport starts below the 48px navbar, so a
 * canvas y renders at screen y + 48.
 */
const PINS = [
  { id: "c-1", x: 500, y: 20, content: "over the first item", author: "test-identity", createdAt: 1, replies: [] },
  { id: "c-2", x: 520, y: 70, content: "over a middle item", author: "test-identity", createdAt: 1, replies: [] },
  { id: "c-3", x: 540, y: 130, content: "over a lower item", author: "test-identity", createdAt: 1, replies: [] },
  { id: "c-4", x: 560, y: 190, content: "over the last item", author: "test-identity", createdAt: 1, replies: [] },
];

/** For pins overlapping the open dropdown, who wins the hit test at the pin centre? */
async function hitsAtPinCentres(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const dd = document.querySelector('[data-testid="options-dropdown"]');
    if (!dd) return { overlapping: 0, dropdownWins: 0, pinWins: 0 };
    const d = dd.getBoundingClientRect();
    const pins = [...document.querySelectorAll("div")].filter((el) => /_pin_/.test(el.className));
    let overlapping = 0, dropdownWins = 0, pinWins = 0;
    for (const pin of pins) {
      const r = pin.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx < d.x || cx > d.x + d.width || cy < d.y || cy > d.y + d.height) continue;
      overlapping++;
      const top = document.elementFromPoint(cx, cy);
      if (top?.closest('[data-testid="options-dropdown"]')) dropdownWins++;
      else if (top?.closest('div[class*="_pin_"]')) pinWins++;
    }
    return { overlapping, dropdownWins, pinWins };
  });
}

test.describe("item 10: navbar dropdowns sit above comment pins", () => {
  test("the pins really do overlap the open dropdown", async ({ page }) => {
    await openBoard(page, { comments: PINS });
    await page.locator('[data-testid="options-btn"]').click();
    await expect(page.locator('[data-testid="options-dropdown"]')).toBeVisible();
    // Guards the spec itself: with no overlap every assertion below is vacuous.
    expect((await hitsAtPinCentres(page)).overlapping).toBeGreaterThanOrEqual(3);
  });

  test("the dropdown wins at every overlapping pin", async ({ page }) => {
    await openBoard(page, { comments: PINS });
    await page.locator('[data-testid="options-btn"]').click();
    const hits = await hitsAtPinCentres(page);
    expect(hits.pinWins).toBe(0);
    expect(hits.dropdownWins).toBe(hits.overlapping);
  });

  test("a pin cannot swallow a click meant for the menu", async ({ page }) => {
    await openBoard(page, { comments: PINS });
    await page.locator('[data-testid="options-btn"]').click();
    const target = await page.evaluate(() => {
      const dd = document.querySelector('[data-testid="options-dropdown"]')!.getBoundingClientRect();
      const hit = [...document.querySelectorAll("div")]
        .filter((el) => /_pin_/.test(el.className))
        .map((p) => p.getBoundingClientRect())
        .find((r) => r.x > dd.x && r.x < dd.x + dd.width && r.y > dd.y && r.y < dd.y + dd.height);
      return hit ? { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 } : null;
    });
    expect(target).not.toBeNull();
    // Clicking where a pin sits must reach the menu, not the pin. Asserted as "no
    // comment popup opened" rather than "the menu closed": some rows (the background
    // swatches) deliberately keep the menu open, so closing is not a reliable signal.
    await page.mouse.click(target!.x, target!.y);
    await expect(page.locator('div[class*="_popup_"]')).toHaveCount(0);
  });

  test("menu items are reachable at their own centres too", async ({ page }) => {
    await openBoard(page, { comments: PINS });
    await page.locator('[data-testid="options-btn"]').click();
    for (const id of ["export-png", "export-svg", "save-project"]) {
      const box = (await page.locator(`[data-testid="${id}"]`).boundingBox())!;
      const top = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid") ?? "",
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      expect(top).toBe(id);
    }
  });

  test("pins still sit above the canvas — the fix must not over-correct", async ({ page }) => {
    await openBoard(page, {
      comments: [{ id: "c-mid", x: 400, y: 400, content: "middle of the board", author: "test-identity", createdAt: 1, replies: [] }],
    });
    const hit = await page.evaluate(() => {
      const pin = [...document.querySelectorAll("div")].find((d) => /_pin_/.test(d.className));
      if (!pin) return "no-pin";
      const r = pin.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      // The topmost node is the icon's <svg><path>, so walk up to its container.
      return el?.closest('div[class*="_pin_"]') ? "pin" : (el?.tagName ?? "?");
    });
    expect(hit).toBe("pin");
  });
});
