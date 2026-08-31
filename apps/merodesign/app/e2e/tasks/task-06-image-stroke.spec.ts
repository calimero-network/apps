import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, pixelAt, near } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 6 — "stroke not working on images and fill also not working on
 * blob images".
 *
 * The image branch passed position, scale, angle and opacity, and never stroke,
 * strokeWidth or fill. Two paths need covering: the decoded bitmap, and the
 * placeholder shown while a peer's blob is still in flight.
 */
const IMG = (over: Record<string, unknown> = {}) =>
  element({
    id: "img-1",
    data: { kind: "image", naturalWidth: 8, naturalHeight: 8, blobId: "blob-1" },
    x: 200, y: 200, width: 200, height: 160,
    ...over,
  });

test.describe("item 6: stroke and fill on images", () => {
  test("a decoded bitmap shows its stroke", async ({ page }) => {
    await openBoard(page, { serveBlob: true, elements: [IMG({ stroke: "#FF0000", strokeWidth: 6 })] });
    // just inside the top edge, and inside the left edge
    expect(near(await pixelAt(page, 300, 201), "#FF0000", 40)).toBe(true);
    expect(near(await pixelAt(page, 201, 280), "#FF0000", 40)).toBe(true);
  });

  test("the stroke does not cover the bitmap itself", async ({ page }) => {
    await openBoard(page, { serveBlob: true, elements: [IMG({ stroke: "#FF0000", strokeWidth: 6 })] });
    // Well inside the bitmap: not red, and not the board background either.
    const mid = await pixelAt(page, 300, 280);
    expect(near(mid, "#FF0000", 40)).toBe(false);
    expect(mid.a).toBeGreaterThan(0);
  });

  test("no stroke means no border pixels", async ({ page }) => {
    await openBoard(page, { serveBlob: true, elements: [IMG()] });
    expect(near(await pixelAt(page, 300, 201), "#FF0000", 40)).toBe(false);
  });

  test("fill tints the placeholder while a blob is still loading", async ({ page }) => {
    // no serveBlob: the fetch fails, so the placeholder is what renders.
    // Probe off-centre — the placeholder centres a "Loading…" label.
    await openBoard(page, { elements: [IMG({ fill: "#FF00FF" })] });
    expect(near(await pixelAt(page, 230, 230), "#FF00FF", 10)).toBe(true);
  });

  test("stroke reaches the placeholder too", async ({ page }) => {
    await openBoard(page, { elements: [IMG({ fill: "#FF00FF", stroke: "#00FFFF", strokeWidth: 4 })] });
    expect(near(await pixelAt(page, 300, 201), "#00FFFF", 40)).toBe(true);
  });
});
