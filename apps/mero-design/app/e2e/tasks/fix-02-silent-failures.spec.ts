import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * Contract mutations were fired as `rpcCall(...).catch(() => {})`. The local store
 * had already been updated, so the UI looked right until the next sync quietly
 * replaced it — the edit was gone with nothing on screen having said so.
 *
 * The sharpest case is version skew: a board whose context still runs an older
 * bundle has no `set_layer_index` and no `corner_radius` argument, so layer moves
 * and corner radii fail *every time* and never persist. Indistinguishable from a UI
 * bug, which is exactly how it shipped.
 */
const RECT = element({ id: "r", x: 200, y: 200, width: 200, height: 120, fill: "#FF00FF" });
const TWO = [RECT, element({ id: "s", x: 450, y: 200, fill: "#00FFFF", layerIndex: 1 })];

async function selectFirst(page: import("@playwright/test").Page) {
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 260);
  await page.waitForTimeout(300);
}

test.describe("failed saves are reported, not swallowed", () => {
  test("a corner radius that cannot be stored says so", async ({ page }) => {
    await openBoard(page, {
      elements: [RECT],
      failMethods: { update_element: "unknown field `corner_radius`" },
    });
    await selectFirst(page);
    await page.locator('[data-testid="prop-corner-radius"]').fill("24");
    await expect(page.getByText(/older version of the app/i)).toBeVisible({ timeout: 15000 });
  });

  test("a layer move against an older contract says so", async ({ page }) => {
    await openBoard(page, {
      elements: TWO,
      failMethods: { set_layer_index: "Method not found" },
    });
    await page.getByText("Layers", { exact: true }).click();
    await page.locator('[data-testid="layer-up-r"]').click();
    await expect(page.getByText(/older version of the app/i)).toBeVisible({ timeout: 15000 });
  });

  test("an ordinary refusal is reported with its reason, not as version skew", async ({ page }) => {
    await openBoard(page, {
      elements: TWO,
      failMethods: { set_layer_index: "not an editor" },
    });
    await page.getByText("Layers", { exact: true }).click();
    await page.locator('[data-testid="layer-up-r"]').click();
    await expect(page.getByText(/not an editor/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/older version of the app/i)).toHaveCount(0);
  });

  test("a failing draw is reported", async ({ page }) => {
    await openBoard(page, { failMethods: { add_element: "invalid type: map, expected unit variant" } });
    await page.locator('[data-testid="tool-line"]').click();
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 260, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText(/older version of the app/i)).toBeVisible({ timeout: 15000 });
  });

  test("a healthy board reports nothing", async ({ page }) => {
    await openBoard(page, { elements: [RECT] });
    await selectFirst(page);
    await page.locator('[data-testid="prop-corner-radius"]').fill("24");
    await page.waitForTimeout(2500);
    await expect(page.getByText(/could not save|older version of the app/i)).toHaveCount(0);
  });

  test("a stale board reports once, not on every drag", async ({ page }) => {
    await openBoard(page, {
      elements: TWO,
      failMethods: { set_layer_index: "Method not found" },
    });
    await page.getByText("Layers", { exact: true }).click();
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-testid="layer-up-r"]').click();
      await page.waitForTimeout(250);
    }
    await expect(page.getByText(/older version of the app/i)).toHaveCount(1);
  });
});
