import { expect, test } from "@playwright/test";
import { CTX_ID, enterOnline, freshState, mockNode, seedSession } from "./helpers";

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
  test("boots into a rendered world with HUD, hotbar and minimap", async ({ page }) => {
    await enterGame(page);
    await expect(page.getByTestId("game-canvas")).toBeVisible();
    await expect(page.getByTestId("debug")).toContainText("online");
    await expect(page.getByTestId("minimap")).toBeVisible();
    for (let i = 0; i < 9; i++) await expect(page.getByTestId(`slot-${i}`)).toBeVisible();
    await expect(page.getByTestId("slot-0")).toHaveClass(/sel/);
  });

  test("starting inventory shows torches and planks", async ({ page }) => {
    await enterGame(page);
    // hotbar order: dirt, stone, plank, torch, ...
    await expect(page.getByTestId("count-3")).toHaveText("30"); // torches
    await expect(page.getByTestId("count-2")).toHaveText("40"); // planks
    await expect(page.getByTestId("count-0")).toHaveText("0"); // no dirt yet
  });

  test("hotbar selection follows number keys", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Digit4");
    await expect(page.getByTestId("slot-3")).toHaveClass(/sel/);
    await expect(page.getByTestId("slot-0")).not.toHaveClass(/sel/);
  });

  test("tile edits persist across a reload (localStorage per world)", async ({ page }) => {
    await enterGame(page);
    await page.evaluate(() => {
      const mt = (window as never as { __mt: { editTile: (...a: number[]) => void } }).__mt;
      mt.editTile(10, 20, 3);
      mt.editTile(11, 20, 8);
    });
    await page.reload();
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mt" in window);
    const overrides = await page.evaluate(() =>
      (window as never as { __mt: { getOverrides: () => Record<string, number> } }).__mt.getOverrides(),
    );
    expect(overrides["10,20"]).toBe(3);
    expect(overrides["11,20"]).toBe(8);
  });

  test("Esc toggles the Minecraft-style game menu; O opens it too", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("options-overlay")).toBeVisible();
    await expect(page.getByTestId("resume-btn")).toHaveText("Back to game");
    await expect(page.getByTestId("options-btn")).toBeVisible();
    await expect(page.getByTestId("invite-btn")).toBeVisible();
    await expect(page.getByTestId("leave-btn")).toBeVisible();
    await page.keyboard.press("Escape"); // toggles back off
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);

    await page.keyboard.press("KeyO"); // O is an alias for the same menu
    await expect(page.getByTestId("options-overlay")).toBeVisible();
    await page.getByTestId("resume-btn").click();
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);
  });

  test("open menu swallows gameplay keys", async ({ page }) => {
    await enterGame(page);
    const input = () =>
      page.evaluate(() =>
        (
          window as never as {
            __mt: { input: () => { digHeld: boolean; placeHeld: boolean; uiOpen: boolean } };
          }
        ).__mt.input(),
      );
    await page.keyboard.press("Escape");
    expect((await input()).uiOpen).toBe(true);
    // hotbar selection is ignored while the menu is open
    await page.keyboard.press("Digit5");
    await expect(page.getByTestId("slot-4")).not.toHaveClass(/sel/);
    await page.getByTestId("resume-btn").click();
    expect((await input()).uiOpen).toBe(false);
    await page.keyboard.press("Digit5");
    await expect(page.getByTestId("slot-4")).toHaveClass(/sel/);
  });

  test("Options screen: zoom slider applies and persists", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("options-btn").click();
    const zoom = page.getByTestId("zoom-slider");
    await expect(zoom).toBeVisible();
    await zoom.fill("1.4");
    await expect(page.getByTestId("zoom-value")).toHaveText("1.4×");
    expect(await page.evaluate(() => localStorage.getItem("mt-zoom"))).toBe("1.4");
    // Done returns to the game menu
    await page.getByTestId("options-done-btn").click();
    await expect(page.getByTestId("resume-btn")).toBeVisible();
    await page.getByTestId("resume-btn").click();
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);
  });

  test("a save from outside the map respawns the player at the surface", async ({ page }) => {
    // a pre-edge-wall save: the player fell off the map and was saved mid-fall
    await page.addInitScript(
      ({ ctxId }) => {
        localStorage.setItem(
          `merraria/${ctxId}`,
          JSON.stringify({
            seed: 4242,
            name: "Faller",
            overrides: {},
            inventory: {},
            player: { x: -40, y: 900, sel: 0, name: "Faller" },
            savedAt: 1720000000000,
          }),
        );
      },
      { ctxId: CTX_ID },
    );
    await enterGame(page);
    const pos = await page.evaluate(
      () => (window as never as { __mt: { player: { x: number; y: number } } }).__mt.player,
    );
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThanOrEqual(400);
    expect(pos.y).toBeGreaterThan(0);
    expect(pos.y).toBeLessThanOrEqual(200);
    // online sessions also toast "Connected to shared world" — pick the rescue one
    await expect(page.locator(".mt-toast", { hasText: "respawned" })).toBeVisible();
  });
});
