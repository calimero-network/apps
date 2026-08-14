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

  test("O opens the game menu, M swaps to the map, Esc closes", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("KeyO");
    await expect(page.getByTestId("options-overlay")).toBeVisible();
    expect((await input(page)).uiOpen).toBe(true);

    await page.keyboard.press("KeyM"); // map replaces the menu
    await expect(page.getByTestId("map-overlay")).toBeVisible();
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);
    await expect(page.getByTestId("map-players")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-overlay")).toHaveCount(0);
    expect((await input(page)).uiOpen).toBe(false);
  });

  test("Esc toggles the Minecraft-style game menu", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("options-overlay")).toBeVisible();
    await expect(page.getByTestId("resume-btn")).toHaveText("Back to game");
    await expect(page.getByTestId("options-btn")).toBeVisible();
    await expect(page.getByTestId("invite-btn")).toBeVisible();
    await expect(page.getByTestId("leave-btn")).toBeVisible();
    await page.keyboard.press("Escape"); // toggles back off
    await expect(page.getByTestId("options-overlay")).toHaveCount(0);
    expect((await input(page)).uiOpen).toBe(false);
  });

  test("Options screen: FOV slider applies and persists", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("options-btn").click();
    const fov = page.getByTestId("fov-slider");
    await expect(fov).toBeVisible();
    await fov.fill("100");
    await expect(page.getByTestId("fov-value")).toHaveText("100°");
    expect(await page.evaluate(() => localStorage.getItem("mb-fov"))).toBe("100");
    // Done returns to the game menu
    await page.getByTestId("options-done-btn").click();
    await expect(page.getByTestId("resume-btn")).toBeVisible();
    await page.getByTestId("resume-btn").click();
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

  // The desktop runs the app in a Tauri (wry) WKWebView, whose WKUIDelegate has
  // no pointer-lock handler at all — the lock is simply never granted, so a look
  // path gated on `document.pointerLockElement` never opens and the camera is
  // dead there, trackpad or mouse. These lock down the fallback, the desktop's
  // no-click-needed arming, and — just as importantly — that the web path is
  // untouched.
  const camera = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      (
        window as never as {
          __mb: { camera: () => { yaw: number; pitch: number; dragLook: boolean } };
        }
      ).__mb.camera(),
    );

  /** Reproduce the desktop webview: requestPointerLock does nothing at all. */
  const breakPointerLock = (page: import("@playwright/test").Page) =>
    page.addInitScript(() => {
      Element.prototype.requestPointerLock = function () {
        return undefined as unknown as void;
      };
    });

  test("with no pointer lock, dragging turns the camera", async ({ page }) => {
    await breakPointerLock(page);
    await enterGame(page);

    const canvas = page.getByTestId("game-canvas");
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // First click is the probe: the lock never arrives, so the fallback arms
    // and the HUD stops claiming "click to play".
    await page.mouse.click(cx, cy);
    await expect(page.getByTestId("hint")).toContainText("drag to look");
    expect((await camera(page)).dragLook).toBe(true);

    // Drag right and well down — down far enough that the crosshair ends up on
    // the ground, which the tap assertion below needs.
    const before = await camera(page);
    await page.mouse.move(cx, cy - 200);
    await page.mouse.down();
    await page.mouse.move(cx + 180, cy + 200, { steps: 12 });
    await page.mouse.up();
    const after = await camera(page);
    expect(after.yaw).not.toBeCloseTo(before.yaw, 3);
    expect(after.pitch).toBeLessThan(before.pitch - 0.5); // looking at the floor

    // A press that never travels is a click, not a look: it mines instead.
    const overrides = () =>
      page.evaluate(() =>
        Object.keys(
          (window as never as { __mb: { getOverrides: () => Record<string, number> } })
            .__mb.getOverrides(),
        ).length,
      );
    const edits = await overrides();
    await page.mouse.click(cx, cy);
    await expect.poll(overrides).toBeGreaterThan(edits);
  });

  // Headless Chromium does not grant pointer lock either, so the happy path
  // cannot be exercised here directly — what matters instead is that a lock
  // arriving late puts the game straight back on the pointer-lock path, which
  // is what keeps a transient failure in a real browser from being permanent.
  test("a pointer lock that does arrive retires the fallback", async ({ page }) => {
    await page.addInitScript(() => {
      let locked: Element | null = null;
      Object.defineProperty(document, "pointerLockElement", {
        get: () => locked,
        configurable: true,
      });
      Element.prototype.requestPointerLock = function () {
        return undefined as unknown as void;
      };
      (window as never as { __grantLock: (el: Element) => void }).__grantLock = (el) => {
        locked = el;
        document.dispatchEvent(new Event("pointerlockchange"));
      };
    });
    await enterGame(page);

    await page.getByTestId("game-canvas").click();
    await expect.poll(async () => (await camera(page)).dragLook).toBe(true);

    await page.evaluate(() =>
      (window as never as { __grantLock: (el: Element) => void }).__grantLock(
        document.querySelector("canvas")!,
      ),
    );
    expect((await camera(page)).dragLook).toBe(false);
    await expect(page.getByTestId("hint")).toContainText("click to play");
  });

  test("in the desktop shell drag-to-look is armed before the first click", async ({ page }) => {
    // NOTE: requestPointerLock is deliberately left intact — the arming has to
    // come from recognizing the runtime, not from watching the API fail. That is
    // the whole point: on the desktop the old code burned the player's first
    // click and half a second discovering what `window.isTauri` already said.
    await page.addInitScript(() => {
      (window as never as { isTauri: boolean }).isTauri = true;
    });
    await enterGame(page);

    expect((await camera(page)).dragLook).toBe(true);
    await expect(page.getByTestId("hint")).toContainText("drag to look");

    // and the very first press already turns the camera — no probe click first
    const canvas = page.getByTestId("game-canvas");
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = await camera(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy, { steps: 10 });
    await page.mouse.up();
    expect((await camera(page)).yaw).not.toBeCloseTo(before.yaw, 3);
  });

  test("arrow keys turn the camera with no pointer at all", async ({ page }) => {
    await enterGame(page);
    const start = await camera(page);

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowRight");
    const turned = await camera(page);
    // right = yaw decreasing, the same convention the mouse uses
    expect(turned.yaw).toBeLessThan(start.yaw - 0.1);

    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowUp");
    const raised = await camera(page);
    expect(raised.pitch).toBeGreaterThan(turned.pitch + 0.1);

    // released keys stop the turn — no drift
    const settled = await camera(page);
    await page.waitForTimeout(150);
    expect((await camera(page)).yaw).toBeCloseTo(settled.yaw, 6);
  });

  test("a trackpad flick nudges the hotbar one slot, not thirty", async ({ page }) => {
    await enterGame(page);
    await expect(page.getByTestId("slot-0")).toHaveClass(/sel/);

    // One gentle two-finger scroll on a MacBook: a stream of small deltas, not
    // one notch. Bound straight to the hotbar this used to step 20 times (and
    // land on slot 2 by wrapping); it is worth exactly one notch.
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++)
        window.dispatchEvent(new WheelEvent("wheel", { deltaY: 5, deltaMode: 0 }));
    });
    await expect(page.getByTestId("slot-1")).toHaveClass(/sel/);
    await expect(page.getByTestId("slot-2")).not.toHaveClass(/sel/);

    // a real mouse notch still steps immediately — one event, one slot
    await page.evaluate(() =>
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, deltaMode: 0 })),
    );
    await expect(page.getByTestId("slot-2")).toHaveClass(/sel/);
  });

  test("options menu has a working sensitivity slider", async ({ page }) => {
    await enterGame(page);
    await page.keyboard.press("KeyO");
    await page.getByTestId("options-btn").click(); // sliders live on the options screen
    const slider = page.getByTestId("sensitivity-slider");
    await slider.fill("1.8");
    await expect(page.getByTestId("sensitivity-value")).toHaveText("1.8×");
    const stored = await page.evaluate(() => localStorage.getItem("mb-sensitivity"));
    expect(stored).toBe("1.8");
  });
});
