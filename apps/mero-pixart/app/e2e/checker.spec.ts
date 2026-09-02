import { test, expect } from "@playwright/test";

// The transparency checkerboard behind the document was drawn square by square:
// ~40,000 fillRect calls per frame on a 1400x1800 document (~113,000 at
// 2400x3000), on every pan and every zoom step, regardless of how many layers
// the document had. It is now one pattern fill.
//
// That is only a safe trade if the pixels are identical, which is what this
// checks — across square sizes, zoom levels (including above the 3x threshold
// where CanvasStage flips image smoothing) and a fractional pan offset.
test("the pattern checkerboard is pixel-identical to the per-square loop", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/scripts/checker-equiv.html");
  await page.waitForFunction(
    () => (window as unknown as { __CHECKER_READY__?: boolean }).__CHECKER_READY__ === true,
    undefined,
    { timeout: 60_000 },
  );
  const cases = await page.evaluate(
    () => (window as unknown as {
      __CHECKER__: { size: number; zoom: number; pan: number; diffBytes: number }[];
    }).__CHECKER__,
  );

  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    expect(
      c.diffBytes,
      `size=${c.size} zoom=${c.zoom} pan=${c.pan} differed in ${c.diffBytes} bytes`,
    ).toBe(0);
  }
});
