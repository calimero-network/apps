import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, paintedBox } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 1 — "Can't select multiple layers at once and move them".
 *
 * Two halves. `onObjectModified` learned to persist an ActiveSelection's children
 * (already in, covered by the regression tests at the bottom). The half that was
 * missing: the store→canvas sync only ever read `selectedElementId`, so picking
 * several layers highlighted exactly one shape and moved exactly one — which is
 * what "the selector should highlight multiple things" is about.
 *
 * These drive the selection through the layers panel rather than a marquee drag:
 * `selection:created` does not fire for a synthetic marquee (see the note that
 * used to be in `pending-01-multi-select.spec.ts`), but shift-clicking rows is a
 * real user path and it exercises the same ActiveSelection code.
 */
const TWO = [
  element({ id: "a", x: 100, y: 100, width: 60, height: 60, fill: "#FF00FF" }),
  element({ id: "b", x: 220, y: 100, width: 60, height: 60, fill: "#00FFFF", layerIndex: 1 }),
];

async function openLayers(page: import("@playwright/test").Page) {
  await page.getByText("Layers", { exact: true }).click();
}

async function selectBoth(page: import("@playwright/test").Page) {
  await openLayers(page);
  await page.locator('[data-testid="layer-item-a"]').click();
  await page.locator('[data-testid="layer-item-b"]').click({ modifiers: ["Shift"] });
}

test.describe("item 1: selecting and moving several layers", () => {
  test("both rows read as selected", async ({ page }) => {
    await openBoard(page, { elements: TWO });
    await selectBoth(page);
    await page.getByText("Props", { exact: true }).click();
    await expect(page.getByText("2 selected")).toBeVisible();
  });

  test("the canvas highlights every selected shape, not just one", async ({ page }) => {
    await openBoard(page, { elements: TWO });
    await selectBoth(page);
    // Fabric's own record of what is active is the ground truth here: a
    // multi-selection is an ActiveSelection holding both objects.
    const active = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="fabric-canvas"]') as
        HTMLCanvasElement & { __fabricCanvas?: { getActiveObject(): unknown } };
      const obj = canvas.__fabricCanvas?.getActiveObject() as
        | { type?: string; getObjects?: () => { data?: { id?: string } }[] }
        | undefined;
      return {
        type: obj?.type ?? null,
        ids: obj?.getObjects?.().map((o) => o.data?.id) ?? [],
      };
    });
    expect(active.type).toBe("activeselection");
    expect([...active.ids].sort()).toEqual(["a", "b"]);
  });

  test("dragging the selection moves and persists both shapes", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await selectBoth(page);
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    // Press inside shape a, which is part of the selection, and drag right.
    await page.mouse.move(box.x + 130, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 190, box.y + 170, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => board.calledWith("update_element").length, { timeout: 15000 }).toBe(2);
    const moved = board.calledWith("update_element").map((c) => c.args.id).sort();
    expect(moved).toEqual(["a", "b"]);
    // And the second shape really moved on screen, not only in the payload.
    const cyan = (await paintedBox(page, "#00FFFF"))!;
    expect(cyan.x).toBeGreaterThan(240);
  });

  test("Delete removes every selected layer", async ({ page }) => {
    const board = await openBoard(page, { elements: TWO });
    await selectBoth(page);
    await page.keyboard.press("Delete");
    await expect.poll(() => board.calledWith("delete_element").map((c) => c.args.id).sort(), { timeout: 15000 })
      .toEqual(["a", "b"]);
  });
});

test.describe("item 1: single-object regressions", () => {
  test("a single-object drag still persists — the multi branch must not swallow it", async ({ page }) => {
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
