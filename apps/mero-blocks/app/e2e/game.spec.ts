import { expect, test } from "@playwright/test";
import { enterOnline, freshState, mockNode, seedSession } from "./helpers";

// The game is online-only: every spec seeds a connected session against the
// mocked node and enters through the "Enter shared world" button.
const enterGame = async (page: import("@playwright/test").Page, seed = 4242) => {
  const state = freshState({ seed });
  await seedSession(page);
  await mockNode(page, state);
  await enterOnline(page);
  return state;
};

test.describe("in-game basics", () => {
  test("boots into a rendered world with HUD", async ({ page }) => {
    await enterGame(page);
    await expect(page.getByTestId("game-canvas")).toBeVisible();
    await expect(page.getByTestId("debug")).toContainText("online");
    await expect(page.getByTestId("hotbar")).toBeVisible();
    // 9 hotbar slots, first selected by default
    for (let i = 0; i < 9; i++) await expect(page.getByTestId(`slot-${i}`)).toBeVisible();
    await expect(page.getByTestId("slot-0")).toHaveClass(/sel/);
    // world actually generated: fps/pos debug line is live
    await expect(page.getByTestId("debug")).toContainText("pos");
  });

  test("hotbar selection follows number keys", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Digit3");
    await expect(page.getByTestId("slot-2")).toHaveClass(/sel/);
    await expect(page.getByTestId("slot-0")).not.toHaveClass(/sel/);
    await page.keyboard.press("Digit9");
    await expect(page.getByTestId("slot-8")).toHaveClass(/sel/);
  });

  test("block edits persist across a reload (localStorage per world)", async ({ page }) => {
    await enterGame(page);
    await page.evaluate(() => {
      const mb = (window as never as { __mb: { editBlock: (...a: number[]) => void } }).__mb;
      mb.editBlock(5, 50, 5, 3); // place stone high in the air
      mb.editBlock(6, 50, 5, 12); // and a glowstone
    });
    await page.reload(); // beforeunload saves
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    const overrides = await page.evaluate(() =>
      (window as never as { __mb: { getOverrides: () => Record<string, number> } }).__mb.getOverrides(),
    );
    expect(overrides["5,50,5"]).toBe(3);
    expect(overrides["6,50,5"]).toBe(12);
  });

  test("world is deterministic for a fixed seed", async ({ page }) => {
    await enterGame(page, 777);
    const sample1 = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(64, 20, 64),
    );
    await page.reload();
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    const sample2 = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(64, 20, 64),
    );
    expect(sample1).toBe(sample2);
  });
});

test.describe("keyboard controls (trackpad-friendly)", () => {
  const input = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      (
        window as never as {
          __mb: { input: () => { breakHeld: boolean; placeHeld: boolean; uiOpen: boolean } };
        }
      ).__mb.input(),
    );

  test("Q and E drive break/place without any mouse button", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.down("KeyQ");
    expect((await input(page)).breakHeld).toBe(true);
    await page.keyboard.up("KeyQ");
    expect((await input(page)).breakHeld).toBe(false);
    await page.keyboard.down("KeyE");
    expect((await input(page)).placeHeld).toBe(true);
    await page.keyboard.up("KeyE");
    expect((await input(page)).placeHeld).toBe(false);
  });

  test("O opens options, M swaps to the map, Esc closes", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("KeyO");
    await expect(page.getByTestId("options-overlay")).toBeVisible();
    expect((await input(page)).uiOpen).toBe(true);

    await page.keyboard.press("KeyM"); // map replaces options
    await expect(page.getByTestId("map-overlay")).toBeVisible();
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);
    await expect(page.getByTestId("map-players")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-overlay")).toHaveCount(0);
    expect((await input(page)).uiOpen).toBe(false);
  });

  test("open menus swallow gameplay keys", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("KeyO");
    await page.keyboard.down("KeyQ");
    expect((await input(page)).breakHeld).toBe(false);
    await page.keyboard.up("KeyQ");
    // hotbar selection is also ignored while a menu is open
    await page.keyboard.press("Digit5");
    await expect(page.getByTestId("slot-4")).not.toHaveClass(/sel/);
    await page.getByTestId("resume-btn").click();
    expect((await input(page)).uiOpen).toBe(false);
  });

  test("options menu has a working sensitivity slider", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("KeyO");
    const slider = page.getByTestId("sensitivity-slider");
    await slider.fill("1.8");
    await expect(page.getByTestId("sensitivity-value")).toHaveText("1.8×");
    const stored = await page.evaluate(() => localStorage.getItem("mb-sensitivity"));
    expect(stored).toBe("1.8");
  });
});
