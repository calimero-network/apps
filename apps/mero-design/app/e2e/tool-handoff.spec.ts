import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBoard } from "./fixtures/board";
import { element } from "./fixtures/canvas";

/**
 * A creation tool used to stay armed forever, and it took no notice of what was
 * already on the board. So the three gestures that follow "draw a rect" all did
 * the wrong thing:
 *
 *   - clicking without dragging made a shape out of nothing (20x20 for an area
 *     shape, a zero-length segment for a line),
 *   - clicking an item drew a second shape on top of it — while Fabric, which
 *     selects a target on mouse-down regardless of the tool, had *also* started
 *     moving the item underneath,
 *   - clicking a text to edit it dropped a fresh "Text" over the old one.
 *
 * These assert the tool's own state, read from the dev store handle, because
 * "the toolbar button looks lit" and "the canvas will draw on the next drag"
 * are not the same claim.
 */

/** The live tool + selection, straight from the store the canvas reads. */
async function toolState(page: Page): Promise<{ tool: string; selected: string | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as {
      __canvasStore: { getState(): { activeTool: string; selectedElementId: string | null } };
    }).__canvasStore.getState();
    return { tool: s.activeTool, selected: s.selectedElementId };
  });
}

/** Press, move through `steps`, release — all in canvas-local coordinates. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = (await page.getByTestId("fabric-canvas").boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test.describe("a click is not a drag", () => {
  test("clicking empty board with the rect tool creates nothing", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 300, y: 250 }, { x: 300, y: 250 });

    expect(board.calledWith("add_element")).toHaveLength(0);
  });

  test("a 2px twitch creates nothing", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 300, y: 250 }, { x: 302, y: 251 });

    expect(board.calledWith("add_element")).toHaveLength(0);
  });

  test("clicking with the line tool creates no zero-length segment", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-line").click();
    await drag(page, { x: 300, y: 250 }, { x: 300, y: 250 });

    expect(board.calledWith("add_element")).toHaveLength(0);
  });

  test("the tool stays armed after a discarded click, so the next drag draws", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 300, y: 250 }, { x: 300, y: 250 });
    expect((await toolState(page)).tool).toBe("rect");

    await drag(page, { x: 300, y: 250 }, { x: 420, y: 340 });
    expect(board.calledWith("add_element")).toHaveLength(1);
  });

  test("a real drag still draws", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 120, y: 120 }, { x: 260, y: 240 });

    const added = board.calledWith("add_element");
    expect(added).toHaveLength(1);
    const el = added[0].args.element as { width: number; height: number };
    expect(el.width).toBeGreaterThan(100);
    expect(el.height).toBeGreaterThan(100);
  });
});

test.describe("the pointer comes back once an item is down", () => {
  test("drawing a rect selects it and re-arms the pointer", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 120, y: 120 }, { x: 260, y: 240 });

    const id = (board.calledWith("add_element")[0].args.element as { id: string }).id;
    expect(await toolState(page)).toEqual({ tool: "select", selected: id });
    await expect(page.getByTestId("tool-select")).toHaveClass(/active/);
  });

  test("drawing a circle re-arms the pointer too", async ({ page }) => {
    await openBoard(page);
    await page.getByTestId("tool-circle").click();
    await drag(page, { x: 150, y: 150 }, { x: 280, y: 280 });

    expect((await toolState(page)).tool).toBe("select");
  });

  test("placing a text re-arms the pointer without ending the edit", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-text").click();
    await drag(page, { x: 200, y: 200 }, { x: 200, y: 200 });

    const added = board.calledWith("add_element");
    expect(added).toHaveLength(1);
    const id = (added[0].args.element as { id: string }).id;
    expect(await toolState(page)).toEqual({ tool: "select", selected: id });

    // The caret must survive the hand-off: `setTool` on its own clears the
    // selection, and an empty selection makes the canvas discard its active
    // object — which would close the editor the click just opened. Fabric backs
    // a live IText edit with a hidden textarea, so that is the tell.
    await expect(page.locator('textarea[data-fabric="textarea"]')).toHaveCount(1);
  });

  test("a second click after a text does not stack a second text", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-text").click();
    await drag(page, { x: 200, y: 200 }, { x: 200, y: 200 });
    await drag(page, { x: 500, y: 400 }, { x: 500, y: 400 });

    expect(board.calledWith("add_element")).toHaveLength(1);
  });
});

test.describe("clicking an item is about that item", () => {
  const seeded = [element({ id: "seed", x: 200, y: 200, width: 160, height: 120, fill: "#FF00FF" })];

  test("clicking a shape with the rect tool selects it instead of drawing", async ({ page }) => {
    const board = await openBoard(page, { elements: seeded });
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 280, y: 260 }, { x: 280, y: 260 });

    expect(board.calledWith("add_element")).toHaveLength(0);
    expect(await toolState(page)).toEqual({ tool: "select", selected: "seed" });
  });

  test("dragging a shape with the rect tool moves it, and draws nothing", async ({ page }) => {
    const board = await openBoard(page, { elements: seeded });
    await page.getByTestId("tool-rect").click();
    await drag(page, { x: 280, y: 260 }, { x: 400, y: 380 });

    expect(board.calledWith("add_element")).toHaveLength(0);
    const moves = board.calledWith("update_element");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[moves.length - 1].args.x).toBeGreaterThan(280);
  });

  test("clicking a text with the text tool selects it instead of stacking a new one", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        element({
          id: "t1",
          data: { kind: "text", content: "Hello", fontSize: 24, fontFamily: "sans-serif", bold: false, italic: false },
          x: 200, y: 200, width: 120, height: 36, fill: "#111111",
        }),
      ],
    });
    await page.getByTestId("tool-text").click();
    await drag(page, { x: 230, y: 212 }, { x: 230, y: 212 });

    expect(board.calledWith("add_element")).toHaveLength(0);
    expect(await toolState(page)).toEqual({ tool: "select", selected: "t1" });
  });
});
