import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, paintedBox } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 5 — "text object cant be resized up and down".
 *
 * The handles exist in Fabric 7. The problem was that dragging one produced a
 * *scale*, and the store only persists x/y/w/h/rotation — so the size was thrown
 * away on the next sync. Resizing now bakes the scale into fontSize and width.
 */
const TEXT = element({
  id: "t", data: { kind: "text", content: "RESIZE ME", fontSize: 24, fontFamily: "sans-serif", bold: true, italic: false },
  x: 150, y: 200, width: 300, height: 34, fill: "#FF00FF",
});

/** Select the text, then drag its bottom-middle handle down. */
async function dragBottomHandle(page: import("@playwright/test").Page, dy: number) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 210);
  await page.waitForTimeout(300);
  const ink = (await paintedBox(page, "#FF00FF", 40))!;
  const handleX = box.x + ink.x + ink.w / 2;
  const handleY = box.y + ink.y + ink.h + 1;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe("item 5: text resizes vertically", () => {
  test("dragging the bottom handle grows the rendered glyphs", async ({ page }) => {
    await openBoard(page, { elements: [TEXT] });
    const before = (await paintedBox(page, "#FF00FF", 40))!;
    await dragBottomHandle(page, 60);
    await page.waitForTimeout(600);
    const after = (await paintedBox(page, "#FF00FF", 40))!;
    expect(after.h).toBeGreaterThan(before.h + 4);
  });

  test("the new size is persisted as a font size, not a scale", async ({ page }) => {
    const board = await openBoard(page, { elements: [TEXT] });
    await dragBottomHandle(page, 60);
    await expect.poll(() => board.calledWith("update_text_style").length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
    const sent = board.calledWith("update_text_style").at(-1)!.args as { font_size: number | null };
    expect(sent.font_size).toBeGreaterThan(24);
  });

  test("the size survives a reload from the contract", async ({ page }) => {
    const board = await openBoard(page, { elements: [TEXT] });
    await dragBottomHandle(page, 60);
    await expect.poll(() => board.calledWith("update_element").length, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
    const grown = (await paintedBox(page, "#FF00FF", 40))!;
    await page.reload();
    await page.waitForSelector('[data-testid="fabric-canvas"]');
    await page.waitForTimeout(1200);
    const reloaded = (await paintedBox(page, "#FF00FF", 40))!;
    expect(Math.abs(reloaded.h - grown.h)).toBeLessThanOrEqual(6);
  });
});
