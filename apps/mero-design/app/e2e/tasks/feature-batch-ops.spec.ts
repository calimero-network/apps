import { test, expect, type Page } from "@playwright/test";
import { MAX_BATCH, openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * Big selections are written in batches.
 *
 * Reported as: copy/paste a large multi-selection and the app dies — every
 * element was its own request (a paste was `Promise.all` over one `add_element`
 * each, so 3000 shapes opened 3000 requests at once and the node answered
 * `network error`), and deleting a selection walked it one `delete_element`
 * round-trip at a time. The fake board refuses any batch over the contract's
 * cap, so a client that stops chunking fails here too.
 */
const N = 600;
const BIG = Array.from({ length: N }, (_, i) =>
  element({ id: `e${String(i).padStart(4, "0")}`, x: 40 + (i % 30) * 16, y: 40 + Math.floor(i / 30) * 16, width: 10, height: 10, layerIndex: i }),
);

/** Marquee the whole grid, starting on empty canvas, the way a user selects an area. */
async function selectAll(page: Page) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 400, { steps: 12 });
  await page.mouse.up();
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

test.describe("large selections", () => {
  test.setTimeout(120_000);

  test(`pasting ${N} elements is a handful of batches, not ${N} requests`, async ({ page }) => {
    const board = await openBoard(page, { elements: BIG });
    await selectAll(page);
    await page.keyboard.press(`${mod}+c`);
    await page.keyboard.press(`${mod}+v`);

    await expect.poll(() => board.writes("add_element").length, { timeout: 60_000 }).toBe(N);
    expect(board.calledWith("add_element")).toHaveLength(0);
    const batches = board.calledWith("add_elements");
    expect(batches.length).toBe(Math.ceil(N / 100));
    expect(batches.every((c) => (c.args.elements as unknown[]).length <= MAX_BATCH)).toBe(true);
    // Every copy reached the board, with a fresh id.
    await expect.poll(() => board.elementsNow().length).toBe(2 * N);
  });

  test(`deleting ${N} selected elements is batched and sized to the board`, async ({ page }) => {
    const board = await openBoard(page, { elements: BIG });
    await selectAll(page);
    await page.keyboard.press("Delete");

    await expect.poll(() => board.elementsNow().length, { timeout: 60_000 }).toBe(0);
    expect(board.calledWith("delete_element")).toHaveLength(0);
    const sizes = board.calledWith("delete_elements").map((c) => (c.args.ids as string[]).length);
    // 15 000 / 600 = 25 ids per call to start, growing as the board empties.
    expect(sizes[0]).toBe(25);
    expect(sizes.length).toBeLessThan(N / 10);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(N);
  });

  test(`moving ${N} selected elements is one update batch per 100`, async ({ page }) => {
    const board = await openBoard(page, { elements: BIG });
    await selectAll(page);
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    // Press on the first shape — part of the selection — and drag.
    await page.mouse.move(box.x + BIG[0].x + 6, box.y + BIG[0].y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + BIG[0].x + 60, box.y + BIG[0].y + 50, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => board.writes("update_element").length, { timeout: 60_000 }).toBe(N);
    expect(board.calledWith("update_element")).toHaveLength(0);
    const batches = board.calledWith("update_elements");
    expect(batches).toHaveLength(Math.ceil(N / 100));
    // One edit: one timestamp across every batch.
    expect(new Set(batches.map((c) => c.args.updated_at)).size).toBe(1);
  });

  // A board keeps the bundle its context was created with. On one that has no
  // batch methods the edit must still be saved — one call at a time — and the
  // user must not be told the board is out of date for something that worked.
  test("a board without the batch methods still saves, one call at a time", async ({ page }) => {
    const missing = (m: string) => `method "${m}" not found`;
    const board = await openBoard(page, {
      elements: BIG.slice(0, 30),
      failMethods: { add_elements: missing("add_elements"), delete_elements: missing("delete_elements") },
    });
    await selectAll(page);
    await page.keyboard.press(`${mod}+c`);
    await page.keyboard.press(`${mod}+v`);
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 30_000 }).toBe(30);
    // Tried once, then remembered.
    expect(board.calledWith("add_elements")).toHaveLength(1);
    await expect.poll(() => board.elementsNow().length).toBe(60);

    await page.keyboard.press("Delete");
    await expect.poll(() => board.elementsNow().length, { timeout: 30_000 }).toBe(30);
    expect(board.calledWith("delete_elements")).toHaveLength(1);
    await expect(page.getByText("runs an older version of the app")).toHaveCount(0);
  });
});
