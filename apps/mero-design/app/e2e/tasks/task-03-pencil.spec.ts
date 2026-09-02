import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { inkAlong, drawWith } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 3 — "pencil item does not do anything at all".
 *
 * Fabric 7 does not create a default `freeDrawingBrush`, so `isDrawingMode = true`
 * was a no-op — and there was no `path:created` handler, so nothing would have been
 * persisted even if it had drawn.
 */
const WHITE = "#FFFFFF";

async function scribble(page: import("@playwright/test").Page) {
  await page.locator('[data-testid="tool-path"]').click();
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  for (const [x, y] of [[260, 240], [320, 200], [380, 260], [440, 220]]) {
    await page.mouse.move(box.x + x, box.y + y, { steps: 6 });
  }
  await page.mouse.up();
}

test.describe("item 3: the pen draws and persists", () => {
  test("a stroke leaves ink on the canvas", async ({ page }) => {
    await openBoard(page);
    await scribble(page);
    const ink = await inkAlong(page, { x: 200, y: 200 }, { x: 260, y: 240 }, WHITE, 12);
    expect(ink).toBeGreaterThanOrEqual(3);
  });

  test("it is persisted as a path element with real path data", async ({ page }) => {
    const board = await openBoard(page);
    await scribble(page);
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 15000 }).toBe(1);
    const el = board.calledWith("add_element")[0].args.element as {
      data: { kind: string; points?: string }; stroke: string; strokeWidth: number;
    };
    expect(el.data.kind).toBe("path");
    expect(el.data.points ?? "").toMatch(/^M/);
    expect(el.stroke).not.toBe("transparent");
    expect(el.strokeWidth).toBeGreaterThan(0);
  });

  test("the persisted path re-renders from the contract", async ({ page }) => {
    const board = await openBoard(page);
    await scribble(page);
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 15000 }).toBe(1);
    // The mock applies mutations, so a reload serves it back.
    await page.reload();
    await page.waitForSelector('[data-testid="fabric-canvas"]');
    await page.waitForTimeout(1200);
    const ink = await inkAlong(page, { x: 200, y: 200 }, { x: 260, y: 240 }, WHITE, 12);
    expect(ink).toBeGreaterThanOrEqual(3);
  });

  test("the select tool does not draw", async ({ page }) => {
    const board = await openBoard(page);
    await drawWith(page, "select", { x: 200, y: 200 }, { x: 320, y: 300 });
    await page.waitForTimeout(600);
    expect(board.calledWith("add_element")).toHaveLength(0);
  });

  test("switching away from the pen stops drawing mode", async ({ page }) => {
    const board = await openBoard(page);
    await scribble(page);
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 15000 }).toBe(1);
    await drawWith(page, "select", { x: 600, y: 500 }, { x: 700, y: 560 });
    await page.waitForTimeout(600);
    expect(board.calledWith("add_element")).toHaveLength(1);
  });
});
