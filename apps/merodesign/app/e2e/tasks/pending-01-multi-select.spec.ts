import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, paintedBox } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 1 — "Can't select multiple layers at once and move them".
 *
 * **NOT counted as done.** The file is named `pending-` on purpose: the code fix is
 * in (see FabricCanvas `onObjectModified`), but the marquee gesture does not form a
 * multi-selection under synthetic Playwright input — `selection:created` fires with
 * an empty `selected` array and a single object active, even though `canvas.selection`
 * is true and both shapes render. Until that is understood, claiming the item is
 * fixed would be claiming an untested fix.
 *
 * What is covered here: the two regressions the fix could have introduced.
 */
const TWO = [
  element({ id: "a", x: 100, y: 100, width: 60, height: 60, fill: "#FF00FF" }),
  element({ id: "b", x: 220, y: 100, width: 60, height: 60, fill: "#00FFFF", layerIndex: 1 }),
];

test.describe("item 1: multi-select (partial)", () => {
  test("a single-object drag still persists — the new branch must not swallow it", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + 130, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 190, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => board.calledWith("update_element").length, { timeout: 15000 }).toBe(1);
    expect(board.calledWith("update_element")[0].args.id).toBe("a");
  });

  test("the moved shape is painted where it was persisted", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + 130, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 190, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => board.calledWith("update_element").length, { timeout: 15000 }).toBe(1);
    const sent = board.calledWith("update_element")[0].args as { x: number; y: number };
    const painted = (await paintedBox(page, "#FF00FF"))!;
    expect(Math.abs(sent.x - painted.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(sent.y - painted.y)).toBeLessThanOrEqual(2);
  });

  test("the other shape does not move", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + 130, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 190, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => board.calledWith("update_element").length, { timeout: 15000 }).toBe(1);
    expect(await paintedBox(page, "#00FFFF")).toMatchObject({ x: 220, y: 100 });
  });
});
