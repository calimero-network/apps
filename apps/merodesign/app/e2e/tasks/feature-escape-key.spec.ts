import { test, expect, type Page } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * Escape.
 *
 * Reported as "esc closes the project instead of deleting the selected element,
 * and doing nothing when nothing is selected". The handler in CanvasPage used to
 * fire on every Escape from anywhere — clearing preview mode and comment mode
 * together, whatever the user was doing — and the canvas's own handler could only
 * delete a single object, never a multi-selection. It now does exactly one thing
 * per press, in order, and calls `preventDefault` so the key never leaves the
 * app.
 */
const TWO = [
  element({ id: "a", x: 100, y: 100, width: 60, height: 60, fill: "#FF00FF" }),
  element({ id: "b", x: 220, y: 100, width: 60, height: 60, fill: "#00FFFF", layerIndex: 1 }),
];

async function openLayers(page: Page) {
  await page.getByText("Layers", { exact: true }).click();
}

/** Fabric's upper canvas sits over the test-id'd one, so click by coordinates. */
async function clickCanvas(page: Page, x: number, y: number) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

test.describe("Escape", () => {
  test("deletes the selected element", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await clickCanvas(page, 130, 130);
    await page.keyboard.press("Escape");
    await expect.poll(() => board.calledWith("delete_element").map((c) => c.args.id), { timeout: 15000 })
      .toEqual(["a"]);
  });

  test("deletes every element of a multi-selection", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await openLayers(page);
    await page.locator('[data-testid="layer-item-a"]').click();
    await page.locator('[data-testid="layer-item-b"]').click({ modifiers: ["Shift"] });
    await page.keyboard.press("Escape");
    await expect.poll(() => board.calledWith("delete_element").map((c) => c.args.id).sort(), { timeout: 15000 })
      .toEqual(["a", "b"]);
  });

  test("does nothing at all when nothing is selected", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    // Empty canvas area, so nothing is picked up.
    await clickCanvas(page, 560, 420);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    expect(board.calledWith("delete_element")).toHaveLength(0);
    // Still on the board — Escape must not navigate away from the project.
    await expect(page.locator('[data-testid="fabric-canvas"]')).toBeVisible();
    expect(page.url()).toContain("/projects/ctx-1");
  });

  test("leaves preview mode before it deletes anything", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await clickCanvas(page, 130, 130);
    await page.getByText("Preview", { exact: true }).click();
    await expect(page.getByText("ESC to exit preview ✕")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByText("ESC to exit preview ✕")).toHaveCount(0);
    await page.waitForTimeout(400);
    // The press that left preview must not also have deleted the selection.
    expect(board.calledWith("delete_element")).toHaveLength(0);
  });

  test("a field's Escape stays in the field", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await clickCanvas(page, 130, 130);
    const rotation = page.locator('[data-testid="prop-rotation"]');
    await rotation.click();
    await rotation.fill("45");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    expect(board.calledWith("delete_element")).toHaveLength(0);
  });
});
