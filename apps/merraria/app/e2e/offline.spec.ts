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

  test("Reset local world wipes the save and starts fresh", async ({ page }) => {
    // no save yet → no reset button on the landing
    await page.goto("/");
    await expect(page.getByTestId("offline-btn")).toBeVisible();
    await expect(page.getByTestId("reset-local-btn")).toHaveCount(0);

    // play and edit → the save exists → the button appears after reload
    await page.getByTestId("offline-btn").click();
    await page.waitForFunction(() => "__mt" in window);
    await page.evaluate(() => {
      const mt = (window as never as { __mt: { editTile: (...a: number[]) => void } }).__mt;
      mt.editTile(10, 20, 3);
    });
    await page.reload();
    await expect(page.getByTestId("reset-local-btn")).toBeVisible();

    // reset → button disappears, and a fresh offline world has no edits
    await page.getByTestId("reset-local-btn").click();
    await expect(page.getByTestId("reset-local-btn")).toHaveCount(0);
    await page.getByTestId("offline-btn").click();
    await page.waitForFunction(() => "__mt" in window);
    const overrides = await page.evaluate(() =>
      (window as never as { __mt: { getOverrides: () => Record<string, number> } }).__mt.getOverrides(),
    );
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  test("a save from outside the map respawns the player at the surface", async ({ page }) => {
    // a pre-edge-wall save: the player fell off the map and was saved mid-fall
    await page.addInitScript(() => {
      localStorage.setItem(
        "merraria/local",
        JSON.stringify({
          seed: 1337,
          name: "Faller",
          overrides: {},
          inventory: {},
          player: { x: -40, y: 900, sel: 0, name: "Faller" },
          savedAt: 1720000000000,
        }),
      );
    });
    await enterOffline(page);
    const pos = await page.evaluate(
      () => (window as never as { __mt: { player: { x: number; y: number } } }).__mt.player,
    );
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThanOrEqual(400);
    expect(pos.y).toBeGreaterThan(0);
    expect(pos.y).toBeLessThanOrEqual(200);
    await expect(page.locator(".mt-toast")).toContainText("respawned");
  });
});
