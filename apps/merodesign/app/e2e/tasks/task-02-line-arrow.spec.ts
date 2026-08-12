import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, drawWith, inkAlong, paintedBox } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 2 — "Line when drawn is not displayed at all ... same thing
 * with arrow item".
 *
 * Three faults: new shapes were created with `stroke: "transparent", strokeWidth: 0`
 * (fine for a rect, fatal for a line); the `el.stroke || "#000"` fallback never
 * fired because "transparent" is truthy; and the drag was normalised to a bounding
 * box, losing which way the line was drawn. Arrows additionally had no head.
 */
const WHITE = "#FFFFFF";

test.describe("item 2: lines and arrows are visible", () => {
  test("a drawn line paints ink along its length", async ({ page }) => {
    const board = await openBoard(page);
    await drawWith(page, "line", { x: 150, y: 150 }, { x: 400, y: 300 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const ink = await inkAlong(page, { x: 150, y: 150 }, { x: 400, y: 300 }, WHITE, 14);
    expect(ink).toBeGreaterThanOrEqual(10);
  });

  test("it is persisted with a paintable stroke, not transparent at width 0", async ({ page }) => {
    const board = await openBoard(page);
    await drawWith(page, "line", { x: 150, y: 150 }, { x: 400, y: 300 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const el = board.calledWith("add_element")[0].args.element as {
      stroke: string; strokeWidth: number; data: { kind: string; points?: string };
    };
    expect(el.data.kind).toBe("line");
    expect(el.stroke).not.toBe("transparent");
    expect(el.strokeWidth).toBeGreaterThan(0);
    expect(el.data.points).toBeTruthy();
  });

  test("the drag direction is preserved, not mirrored", async ({ page }) => {
    const board = await openBoard(page);
    // bottom-left to top-right
    await drawWith(page, "line", { x: 150, y: 400 }, { x: 400, y: 200 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const drawn = await inkAlong(page, { x: 150, y: 400 }, { x: 400, y: 200 }, WHITE, 14);
    const mirrored = await inkAlong(page, { x: 150, y: 200 }, { x: 400, y: 400 }, WHITE, 14);
    expect(drawn).toBeGreaterThanOrEqual(10);
    expect(mirrored).toBeLessThan(4);
  });

  test("a horizontal line is not forced to 20px tall", async ({ page }) => {
    const board = await openBoard(page);
    await drawWith(page, "line", { x: 150, y: 250 }, { x: 420, y: 250 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const el = board.calledWith("add_element")[0].args.element as { height: number };
    expect(el.height).toBeLessThanOrEqual(2);
  });

  test("a seeded line renders from the contract too", async ({ page }) => {
    await openBoard(page, {
      elements: [element({
        id: "l", data: { kind: "line", points: "0,0 200,120" },
        x: 200, y: 200, width: 200, height: 120,
        fill: "transparent", stroke: "#FF00FF", strokeWidth: 4,
      })],
    });
    const box = await paintedBox(page, "#FF00FF", 30);
    expect(box).not.toBeNull();
    expect(box!.pixels).toBeGreaterThan(50);
  });

  test("an arrow gets a head, and a line does not", async ({ page }) => {
    await openBoard(page, {
      elements: [
        element({ id: "arr", data: { kind: "arrow", points: "0,0 200,0" }, x: 150, y: 200,
          width: 200, height: 0, fill: "transparent", stroke: "#FF00FF", strokeWidth: 3 }),
        element({ id: "ln", data: { kind: "line", points: "0,0 200,0" }, x: 150, y: 400,
          width: 200, height: 0, fill: "transparent", stroke: "#00FFFF", strokeWidth: 3, layerIndex: 1 }),
      ],
    });
    const arrow = (await paintedBox(page, "#FF00FF", 30))!;
    const line = (await paintedBox(page, "#00FFFF", 30))!;
    // Both are 3px horizontal strokes of the same length, so the only thing that can
    // make the arrow taller is the head. Compare heights, not pixel counts: the head
    // is a small triangle and overlaps the stroke it sits on.
    expect(line.h).toBeLessThanOrEqual(6);
    expect(arrow.h).toBeGreaterThanOrEqual(line.h + 3);
    expect(arrow.pixels).toBeGreaterThan(line.pixels);
  });
});
