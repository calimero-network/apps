import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * Undo only ever changed this tab's store. It swapped in a copy of the whole
 * board taken before the action and wrote nothing, so the node — and every
 * teammate — kept the edit, and this tab's next sync put it straight back.
 *
 * These read the MOCKED NODE's state (`elementsNow`), not the canvas: an undo
 * that only repaints is exactly the bug.
 */
const RECT = element({ id: "r", x: 200, y: 200, width: 200, height: 120, fill: "#FF00FF" });

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function selectRect(page: import("@playwright/test").Page) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 260);
  await page.waitForTimeout(300);
}

/** Focus back on the canvas, off any inspector field, without touching a shape. */
async function focusCanvas(page: import("@playwright/test").Page) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + 40);
}

test.describe("undo and redo reach the node", () => {
  test("undoing a delete puts the shape back on the node, and redo removes it again", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await selectRect(page);
    await page.keyboard.press("Delete");
    await expect.poll(() => board.elementsNow().map((e) => e.id)).toEqual([]);

    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => board.elementsNow().map((e) => e.id)).toEqual(["r"]);
    expect(board.elementsNow()[0]).toMatchObject({ x: 200, y: 200, fill: "#FF00FF" });

    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(() => board.elementsNow().map((e) => e.id)).toEqual([]);
  });

  test("undoing an inspector edit still held for sending ends with the old value on the node", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await selectRect(page);
    await page.locator('[data-testid="prop-x"]').fill("420");
    await page.locator('[data-testid="prop-x"]').press("Enter");
    // Inside the inspector's two-second hold: the edit has not gone out yet.
    await focusCanvas(page);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => board.elementsNow()[0]?.x).toBe(200);
    // The held edit must not land on top of the undo afterwards.
    await page.waitForTimeout(2500);
    expect(board.elementsNow()[0]?.x).toBe(200);
  });

  test("undo from the options menu writes too", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await selectRect(page);
    await page.keyboard.press("Delete");
    await expect.poll(() => board.elementsNow().length).toBe(0);
    await page.getByTestId("options-btn").click();
    await page.getByTestId("undo-btn").click();
    await expect.poll(() => board.elementsNow().map((e) => e.id)).toEqual(["r"]);
  });
});
