import { expect, test } from "@playwright/test";
import { enterOffline } from "./helpers";

test.describe("offline mode", () => {
  test("boots into a rendered world with HUD, hotbar and minimap", async ({ page }) => {
    await enterOffline(page);
    await expect(page.getByTestId("game-canvas")).toBeVisible();
    await expect(page.getByTestId("debug")).toContainText("offline");
    await expect(page.getByTestId("minimap")).toBeVisible();
    for (let i = 0; i < 9; i++) await expect(page.getByTestId(`slot-${i}`)).toBeVisible();
    await expect(page.getByTestId("slot-0")).toHaveClass(/sel/);
  });

  test("starting inventory shows torches and planks", async ({ page }) => {
    await enterOffline(page);
    // hotbar order: dirt, stone, plank, torch, ...
    await expect(page.getByTestId("count-3")).toHaveText("30"); // torches
    await expect(page.getByTestId("count-2")).toHaveText("40"); // planks
    await expect(page.getByTestId("count-0")).toHaveText("0"); // no dirt yet
  });

  test("hotbar selection follows number keys", async ({ page }) => {
    await enterOffline(page);
    await page.keyboard.press("Digit4");
    await expect(page.getByTestId("slot-3")).toHaveClass(/sel/);
    await expect(page.getByTestId("slot-0")).not.toHaveClass(/sel/);
  });

  test("tile edits persist across a reload", async ({ page }) => {
    await enterOffline(page);
    await page.evaluate(() => {
      const mt = (window as never as { __mt: { editTile: (...a: number[]) => void } }).__mt;
      mt.editTile(10, 20, 3);
      mt.editTile(11, 20, 8);
    });
    await page.reload();
    await page.getByTestId("offline-btn").click();
    await page.waitForFunction(() => "__mt" in window);
    const overrides = await page.evaluate(() =>
      (window as never as { __mt: { getOverrides: () => Record<string, number> } }).__mt.getOverrides(),
    );
    expect(overrides["10,20"]).toBe(3);
    expect(overrides["11,20"]).toBe(8);
  });
});
