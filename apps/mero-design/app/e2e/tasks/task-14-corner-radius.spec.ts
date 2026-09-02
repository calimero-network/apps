import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element, pixelAt, near } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 14 — "Ability to add rounded corners on rectangles and such".
 *
 * New `corner_radius` on the contract's Element, `rx`/`ry` on the Fabric rect, a
 * clamped input in the properties panel, and `border-radius` in the code export.
 */
const RECT = (over: Record<string, unknown> = {}) =>
  element({ id: "r", x: 200, y: 200, width: 200, height: 120, fill: "#FF00FF", ...over });

test.describe("item 14: rounded corners", () => {
  test("a radius rounds the corner away while the edge stays filled", async ({ page }) => {
    await openBoard(page, { elements: [RECT({ cornerRadius: 40 })] });
    // 2px inside the corner: background. Mid-edge: fill.
    expect(near(await pixelAt(page, 202, 202), "#FF00FF")).toBe(false);
    expect(near(await pixelAt(page, 300, 202), "#FF00FF")).toBe(true);
  });

  test("radius 0 keeps square corners", async ({ page }) => {
    await openBoard(page, { elements: [RECT({ cornerRadius: 0 })] });
    expect(near(await pixelAt(page, 202, 202), "#FF00FF")).toBe(true);
  });

  test("the panel clamps a radius larger than half the shorter side", async ({ page }) => {
    await openBoard(page, { elements: [RECT()] });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 300, box.y + 260);
    const input = page.locator('[data-testid="prop-corner-radius"]');
    await expect(input).toBeVisible();
    await input.fill("500");
    await page.waitForTimeout(400);
    // half of the 120px side
    await expect(input).toHaveValue("60");
  });

  test("the radius is persisted to the contract", async ({ page }) => {
    const board = await openBoard(page, { elements: [RECT()] });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 300, box.y + 260);
    await page.locator('[data-testid="prop-corner-radius"]').fill("24");
    await expect.poll(() => board.calledWith("update_element").filter((c) => c.args.corner_radius === 24).length,
      { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  });
});
