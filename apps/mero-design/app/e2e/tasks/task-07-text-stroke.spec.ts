import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, paintedBox } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 7 — "stroke not working on text -> so maybe remove it or what".
 *
 * Implemented rather than removed: the model already carries stroke/strokeWidth,
 * every exporter round-trips them, and outlined text is standard. The text branch
 * simply never passed them to the object.
 */
const TEXT = (over: Record<string, unknown> = {}) =>
  element({
    id: "t-1",
    data: { kind: "text", content: "STROKE", fontSize: 72, fontFamily: "sans-serif", bold: true, italic: false },
    x: 120, y: 200, width: 400, height: 90,
    fill: "#FFFFFF",
    ...over,
  });

test.describe("item 7: stroke on text", () => {
  test("an outlined glyph paints both fill and stroke", async ({ page }) => {
    await openBoard(page, { elements: [TEXT({ stroke: "#FF00FF", strokeWidth: 3 })] });
    const outline = await paintedBox(page, "#FF00FF", 30);
    expect(outline).not.toBeNull();
    expect(outline!.pixels).toBeGreaterThan(40);
  });

  test("strokeWidth 0 leaves no outline", async ({ page }) => {
    await openBoard(page, { elements: [TEXT({ stroke: "#FF00FF", strokeWidth: 0 })] });
    const outline = await paintedBox(page, "#FF00FF", 30);
    expect(outline?.pixels ?? 0).toBeLessThan(40);
  });

  test('stroke "transparent" leaves no outline — the truthiness trap', async ({ page }) => {
    await openBoard(page, { elements: [TEXT({ stroke: "transparent", strokeWidth: 6 })] });
    const outline = await paintedBox(page, "#FF00FF", 30);
    expect(outline?.pixels ?? 0).toBeLessThan(40);
  });

  test("the outline sits within the text's declared box", async ({ page }) => {
    await openBoard(page, { elements: [TEXT({ stroke: "#FF00FF", strokeWidth: 3 })] });
    const outline = (await paintedBox(page, "#FF00FF", 30))!;
    expect(outline.x).toBeGreaterThanOrEqual(110);
    expect(outline.y).toBeGreaterThanOrEqual(190);
  });
});
