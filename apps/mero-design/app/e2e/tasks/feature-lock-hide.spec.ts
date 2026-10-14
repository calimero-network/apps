import { test, expect, type Page } from "@playwright/test";
import { openBoard, type Board } from "../fixtures/board";
import { element, paintedBox } from "../fixtures/canvas";
import { fromWire } from "../../src/utils/elementMeta";

/**
 * Lock and hide ride the element's label (`utils/elementMeta.ts`), like stroke
 * style and groups, so the contract and the stored element layout do not
 * change. These read the MOCKED NODE (`elementsNow`) for what was saved and the
 * canvas pixels for what is painted.
 */
const SEP = "\u001F";
const RECT = element({ id: "r", x: 200, y: 200, width: 200, height: 120, fill: "#FF00FF" });

/** The element as the app reads it back from the node: flags unpacked. */
const saved = (board: Board, id = "r") => fromWire(board.elementsNow().find((e) => e.id === id)!);

async function openLayers(page: Page) {
  await page.getByText("Layers", { exact: true }).click();
}

async function clickRect(page: Page) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 260);
  await page.waitForTimeout(300);
}

async function dragRect(page: Page, dx: number, dy: number) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 300 + dx, box.y + 260 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test.describe("lock and hide", () => {
  test("hiding from the layers panel saves the flag and stops painting the layer; showing undoes both", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    expect(await paintedBox(page, "#FF00FF")).not.toBeNull();
    await openLayers(page);

    await page.getByTestId("layer-r-hide").click();
    await expect.poll(() => saved(board).hidden).toBe(true);
    await expect(page.getByTestId("layer-r-hide")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => paintedBox(page, "#FF00FF")).toBeNull();

    await page.getByTestId("layer-r-hide").click();
    await expect.poll(() => saved(board).hidden).toBeUndefined();
    // No flags left: the stored label is exactly what it was before.
    expect(board.elementsNow()[0].label ?? null).toBeNull();
    await expect.poll(async () => (await paintedBox(page, "#FF00FF")) !== null).toBe(true);
  });

  test("a locked layer cannot be selected, dragged or deleted on the canvas", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await openLayers(page);
    await page.getByTestId("layer-r-lock").click();
    await expect.poll(() => saved(board).locked).toBe(true);

    await dragRect(page, 150, 100);
    expect(saved(board).x).toBe(200);
    await clickRect(page);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(board.elementsNow().map((e) => e.id)).toEqual(["r"]);
    // A marquee around it does not pick it up either.
    const canvas = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.move(canvas.x + 150, canvas.y + 150);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 460, canvas.y + 380, { steps: 8 });
    await page.mouse.up();
    await dragRect(page, 150, 100);
    expect(saved(board).x).toBe(200);
    // Still painted: a lock is not a hide.
    expect(await paintedBox(page, "#FF00FF")).not.toBeNull();

    await page.getByTestId("layer-r-lock").click();
    await expect.poll(() => saved(board).locked).toBeUndefined();
    await dragRect(page, 150, 100);
    await expect.poll(() => saved(board).x).not.toBe(200);
  });

  test("Shift+Ctrl+L locks and Shift+Ctrl+H hides the selection; pressing again reverses it", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await clickRect(page);

    await page.keyboard.press("Control+Shift+L");
    await expect.poll(() => saved(board).locked).toBe(true);
    await page.keyboard.press("Control+Shift+L");
    await expect.poll(() => saved(board).locked).toBeUndefined();

    await page.keyboard.press("Control+Shift+H");
    await expect.poll(() => saved(board).hidden).toBe(true);
    await expect.poll(() => paintedBox(page, "#FF00FF")).toBeNull();
    await page.keyboard.press("Control+Shift+H");
    await expect.poll(() => saved(board).hidden).toBeUndefined();
  });

  test("hiding is one undo step, and the undo reaches the node", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT] });
    await clickRect(page);
    await page.keyboard.press("Control+Shift+H");
    await expect.poll(() => saved(board).hidden).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(() => saved(board).hidden).toBeUndefined();
    await expect.poll(async () => (await paintedBox(page, "#FF00FF")) !== null).toBe(true);
  });

  test("locking a group locks every layer in it", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        { ...RECT, label: "hero/Card" },
        element({ id: "s", x: 450, y: 200, fill: "#00FFFF", layerIndex: 1, label: "hero/Badge" }),
      ],
    });
    await openLayers(page);
    await page.getByTestId("group-hero-lock").click();
    await expect.poll(() => [saved(board, "r").locked, saved(board, "s").locked]).toEqual([true, true]);
    // The group path in front of the flags is untouched.
    expect(saved(board, "r").label).toBe("hero/Card");
  });

  // Backward compatibility: a board saved before lock/hide existed — including
  // labels that already carry other extras — loads unlocked and shown, and a
  // lock added later keeps those extras.
  test("a board saved before lock/hide loads unlocked and shown, and keeps its other extras when locked", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        { ...RECT, label: `Card${SEP}s=dashed`, stroke: "#000000", strokeWidth: 4 },
        element({ id: "s", x: 450, y: 200, fill: "#00FFFF", layerIndex: 1, label: "Badge" }),
      ],
    });
    expect(await paintedBox(page, "#FF00FF")).not.toBeNull();
    expect(await paintedBox(page, "#00FFFF")).not.toBeNull();
    await openLayers(page);
    for (const id of ["r", "s"]) {
      await expect(page.getByTestId(`layer-${id}-lock`)).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId(`layer-${id}-hide`)).toHaveAttribute("aria-pressed", "false");
    }
    // Unlocked: a click on the canvas selects it.
    await clickRect(page);
    await expect(page.getByTestId("layer-item-r")).toHaveClass(/layerItemActive/);

    await page.keyboard.press("Control+Shift+L");
    await expect.poll(() => saved(board).locked).toBe(true);
    expect(saved(board)).toMatchObject({ label: "Card", strokeStyle: "dashed" });
  });
});
