import { expect, test } from "@playwright/test";
import { enterOffline } from "./helpers";

test.describe("offline mode", () => {
  test("boots into a rendered world with HUD", async ({ page }) => {
    await enterOffline(page);
    await expect(page.getByTestId("game-canvas")).toBeVisible();
    await expect(page.getByTestId("debug")).toContainText("offline");
    await expect(page.getByTestId("hotbar")).toBeVisible();
    // 9 hotbar slots, first selected by default
    for (let i = 0; i < 9; i++) await expect(page.getByTestId(`slot-${i}`)).toBeVisible();
    await expect(page.getByTestId("slot-0")).toHaveClass(/sel/);
    // world actually generated: fps/pos debug line is live
    await expect(page.getByTestId("debug")).toContainText("pos");
  });

  test("hotbar selection follows number keys", async ({ page }) => {
    await enterOffline(page);
    await page.keyboard.press("Digit3");
    await expect(page.getByTestId("slot-2")).toHaveClass(/sel/);
    await expect(page.getByTestId("slot-0")).not.toHaveClass(/sel/);
    await page.keyboard.press("Digit9");
    await expect(page.getByTestId("slot-8")).toHaveClass(/sel/);
  });

  test("block edits persist across a reload (localStorage)", async ({ page }) => {
    await enterOffline(page);
    await page.evaluate(() => {
      const mb = (window as never as { __mb: { editBlock: (...a: number[]) => void } }).__mb;
      mb.editBlock(5, 50, 5, 3); // place stone high in the air
      mb.editBlock(6, 50, 5, 12); // and a glowstone
    });
    await page.reload(); // beforeunload saves
    await page.getByTestId("offline-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    const overrides = await page.evaluate(() =>
      (window as never as { __mb: { getOverrides: () => Record<string, number> } }).__mb.getOverrides(),
    );
    expect(overrides["5,50,5"]).toBe(3);
    expect(overrides["6,50,5"]).toBe(12);
  });

  test("world is deterministic for a fixed seed", async ({ page }) => {
    await enterOffline(page);
    const sample1 = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(64, 20, 64),
    );
    await page.reload();
    await page.getByTestId("offline-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    const sample2 = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(64, 20, 64),
    );
    expect(sample1).toBe(sample2);
  });
});
