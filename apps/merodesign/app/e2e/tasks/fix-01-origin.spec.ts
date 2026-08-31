import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, paintedBox, pixelAt, near, drawWith } from "../fixtures/canvas";

/**
 * Fabric 7 defaults originX/originY to "center", so it reads left/top as an
 * object's centre while every coordinate in this app is a top-left. Every shape
 * painted offset by half its own size. Not an IMPORTANT.md item — found while
 * building the starter project, and the substrate several other reports sit on.
 *
 * Asserted numerically, because a half-size offset looks like a design choice.
 */
test.describe("origin: shapes paint where they are declared", () => {
  test("a 40x40 rect at (100,100) paints at exactly (100,100)", async ({ page }) => {
    await openBoard(page, {
      elements: [element({ id: "a", x: 100, y: 100, width: 40, height: 40, fill: "#FF00FF" })],
    });
    const box = await paintedBox(page, "#FF00FF");
    expect(box).not.toBeNull();
    expect({ x: box!.x, y: box!.y }).toEqual({ x: 100, y: 100 });
    expect({ w: box!.w, h: box!.h }).toEqual({ w: 40, h: 40 });
  });

  // A square hides a half-size offset in one axis; an oblong cannot.
  test("a 76x22 rect keeps both axes independent", async ({ page }) => {
    await openBoard(page, {
      elements: [element({ id: "a", x: 712, y: 400, width: 76, height: 22, fill: "#00FFFF" })],
    });
    const box = await paintedBox(page, "#00FFFF");
    expect(box).not.toBeNull();
    expect({ x: box!.x, y: box!.y, w: box!.w, h: box!.h }).toEqual({ x: 712, y: 400, w: 76, h: 22 });
  });

  test("two shapes far apart are both exact — not a uniform viewport pan", async ({ page }) => {
    await openBoard(page, {
      elements: [
        element({ id: "a", x: 60, y: 60, width: 40, height: 40, fill: "#FF00FF" }),
        element({ id: "b", x: 900, y: 500, width: 40, height: 40, fill: "#00FFFF", layerIndex: 1 }),
      ],
    });
    expect(await paintedBox(page, "#FF00FF")).toMatchObject({ x: 60, y: 60 });
    expect(await paintedBox(page, "#00FFFF")).toMatchObject({ x: 900, y: 500 });
  });

  test("the gap between two shapes matches the declared gap", async ({ page }) => {
    await openBoard(page, {
      elements: [
        element({ id: "a", x: 100, y: 200, width: 50, height: 50, fill: "#FF00FF" }),
        element({ id: "b", x: 250, y: 200, width: 50, height: 50, fill: "#00FFFF", layerIndex: 1 }),
      ],
    });
    const a = (await paintedBox(page, "#FF00FF"))!;
    const b = (await paintedBox(page, "#00FFFF"))!;
    expect(b.x - (a.x + a.w)).toBe(100); // 250 - (100+50)
  });

  test("a circle paints inside its declared box", async ({ page }) => {
    await openBoard(page, {
      elements: [
        element({ id: "c", data: { kind: "circle" }, x: 300, y: 300, width: 80, height: 80, fill: "#FF00FF" }),
      ],
    });
    // centre is filled, and a point outside the declared box is not
    expect(near(await pixelAt(page, 340, 340), "#FF00FF")).toBe(true);
    expect(near(await pixelAt(page, 300 - 12, 300 - 12), "#FF00FF")).toBe(false);
  });

  test("a drawn rect does not jump when the store syncs it back", async ({ page }) => {
    const board = await openBoard(page);
    await drawWith(page, "rect", { x: 200, y: 200 }, { x: 320, y: 300 });
    // add_element is fired after mouse-up, so wait for it rather than racing it.
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const added = board.calledWith("add_element");
    const el = added[0].args.element as { x: number; y: number; width: number; height: number };
    // What was persisted is what is painted: probe the middle of the declared box.
    const mid = await pixelAt(page, el.x + el.width / 2, el.y + el.height / 2);
    expect(mid.a).toBeGreaterThan(0);
    expect(near(mid, "#4F8EF7", 24)).toBe(true);
  });
});
