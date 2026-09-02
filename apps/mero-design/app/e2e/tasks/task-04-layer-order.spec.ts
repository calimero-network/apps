import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 4 — "layers -> up and down should only do 1 up or down not
 * front to back".
 *
 * The local swap was already correct. Both handlers then called
 * `bring_to_front` / `send_to_back`, so the contract recorded a jump and the next
 * sync overwrote the one-step move. The contract had no one-step method at all —
 * `set_layer_index` is new.
 */
const THREE = [
  element({ id: "a", x: 100, y: 100, fill: "#FF00FF", layerIndex: 0 }),
  element({ id: "b", x: 160, y: 100, fill: "#00FFFF", layerIndex: 1 }),
  element({ id: "c", x: 220, y: 100, fill: "#FFFF00", layerIndex: 2 }),
];

async function openLayers(page: import("@playwright/test").Page) {
  await page.getByText("Layers", { exact: true }).click();
}

test.describe("item 4: one-step layer moves", () => {
  test("moving up calls set_layer_index, never bring_to_front", async ({ page }) => {
    const board = await openBoard(page, { elements: THREE });
    await openLayers(page);
    await page.locator('[data-testid="layer-up-b"]').click();
    await expect.poll(() => board.calledWith("set_layer_index").length, { timeout: 10000 }).toBe(1);
    expect(board.calledWith("bring_to_front")).toHaveLength(0);
  });

  test("it moves exactly one step, not to the top", async ({ page }) => {
    const board = await openBoard(page, { elements: THREE });
    await openLayers(page);
    await page.locator('[data-testid="layer-up-a"]').click();
    await expect.poll(() => board.calledWith("set_layer_index").length, { timeout: 10000 }).toBe(1);
    const call = board.calledWith("set_layer_index")[0];
    expect(call.args.id).toBe("a");
    expect(call.args.index).toBe(1); // one up from 0, not 2
  });

  test("moving down also asks for one step", async ({ page }) => {
    const board = await openBoard(page, { elements: THREE });
    await openLayers(page);
    await page.locator('[data-testid="layer-down-c"]').click();
    await expect.poll(() => board.calledWith("set_layer_index").length, { timeout: 10000 }).toBe(1);
    expect(board.calledWith("set_layer_index")[0].args.index).toBe(1);
    expect(board.calledWith("send_to_back")).toHaveLength(0);
  });

  test("bring-to-front still jumps all the way", async ({ page }) => {
    const board = await openBoard(page, { elements: THREE });
    // Select on the canvas so the Properties tab has a target.
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 120, box.y + 120);
    await page.waitForTimeout(400);
    const front = page.locator('[data-testid="bring-to-front"]');
    await expect(front).toBeVisible();
    await front.click();
    await expect.poll(() => board.calledWith("bring_to_front").length, { timeout: 10000 }).toBe(1);
    // and it is not the one-step call
    expect(board.calledWith("set_layer_index")).toHaveLength(0);
  });
});
