import { expect, test } from "@playwright/test";
import { enterOnline, freshState, mockNode, remotePlayer, seedSession } from "./helpers";

test.describe("online mode (mocked node)", () => {
  test("connect pulls world meta and overrides", async ({ page }) => {
    const state = freshState({ overrides: [{ k: "50,60", t: 3 }] });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    await expect(page.getByTestId("debug")).toContainText("online");
    expect(state.methods).toContain("world_meta");
    expect(state.methods).toContain("join");
    expect(state.methods).toContain("get_overrides");
    const t = await page.evaluate(() =>
      (window as never as { __mt: { world: { getTile: (x: number, y: number) => number } } })
        .__mt.world.getTile(50, 60),
    );
    expect(t).toBe(3);
  });

  test("local edits are batched into one set_tiles call", async ({ page }) => {
    const state = freshState();
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    await page.evaluate(() => {
      const mt = (window as never as { __mt: { editTile: (...a: number[]) => void } }).__mt;
      mt.editTile(60, 30, 3);
      mt.editTile(61, 30, 7);
      mt.editTile(61, 30, 14); // coalesces
    });
    await expect.poll(() => state.setTileCalls.length, { timeout: 5000 }).toBeGreaterThan(0);
    const batch = state.setTileCalls[0];
    expect(batch.edits).toHaveLength(2);
    expect(batch.edits.find((e) => e.x === 61)!.t).toBe(14);
  });

  test("a TilesChanged nudge applies a peer's edits live", async ({ page }) => {
    const state = freshState();
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    state.overrides.push({ k: "70,40", t: 14 });
    await page.evaluate(() => {
      (window as never as {
        __mt: { sync: { handleEvent: (ev: { kind: string; value: string }) => void } };
      }).__mt.sync.handleEvent({ kind: "TilesChanged", value: "some-peer" });
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as never as { __mt: { world: { getTile: (x: number, y: number) => number } } })
            .__mt.world.getTile(70, 40),
        ),
      )
      .toBe(14);
  });

  test("remote players show up and leave", async ({ page }) => {
    const state = freshState({ players: [remotePlayer("peer-1", "Terra")] });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    await expect(page.getByTestId("players")).toContainText("Terra", { timeout: 8000 });
    await expect(page.getByTestId("debug")).toContainText("peers 1");
    state.players = [];
    await expect(page.getByTestId("players")).not.toContainText("Terra", { timeout: 8000 });
  });

  test("heartbeats flow while playing", async ({ page }) => {
    const state = freshState();
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);
    await expect
      .poll(() => state.methods.filter((m) => m === "heartbeat").length, { timeout: 8000 })
      .toBeGreaterThan(0);
  });

  test("an unreachable world is a hard stop — error screen, no offline fallback", async ({ page }) => {
    await seedSession(page);
    await page.route("**/jsonrpc", (route) => route.abort());
    await page.goto("/");
    await page.getByTestId("connect-btn").click();
    await expect(page.getByTestId("fatal-error")).toBeVisible();
    await expect(page.getByTestId("fatal-message")).toContainText("Could not reach the shared world");
    await expect(page.getByTestId("back-to-title-btn")).toBeVisible();
    // the game never booted
    const started = await page.evaluate(() => "__mt" in window);
    expect(started).toBe(false);
  });
});
