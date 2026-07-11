import { expect, test } from "@playwright/test";
import {
  enterOnline,
  freshState,
  mockNode,
  remotePlayer,
  seedSession,
} from "./helpers";

test.describe("online mode (mocked node)", () => {
  test("connect pulls world meta and overrides from the contract", async ({ page }) => {
    const state = freshState({ overrides: [{ k: "10,50,10", b: 3 }] });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    await expect(page.getByTestId("debug")).toContainText("online");
    expect(state.methods).toContain("world_meta");
    expect(state.methods).toContain("join");
    expect(state.methods).toContain("get_overrides");

    // the remote override is applied into the local world
    const b = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(10, 50, 10),
    );
    expect(b).toBe(3);
  });

  test("world seed comes from the contract, not the input field", async ({ page }) => {
    const state = freshState({ seed: 777 });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);
    await expect(page.getByTestId("debug")).toContainText("online");
    expect(state.methods).toContain("world_meta");
  });

  test("local edits are batched into one set_blocks call", async ({ page }) => {
    const state = freshState();
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    await page.evaluate(() => {
      const mb = (window as never as { __mb: { editBlock: (...a: number[]) => void } }).__mb;
      mb.editBlock(20, 50, 20, 3);
      mb.editBlock(21, 50, 20, 8);
      mb.editBlock(21, 50, 20, 9); // same block again — coalesces
    });
    await expect
      .poll(() => state.setBlockCalls.length, { timeout: 5000 })
      .toBeGreaterThan(0);
    const batch = state.setBlockCalls[0];
    expect(batch.edits).toHaveLength(2); // coalesced per block key
    expect(batch.edits.find((e) => e.x === 21)!.b).toBe(9); // last write won
    expect(typeof batch.now).toBe("number");
  });

  test("a BlocksChanged nudge applies a peer's edits without reload", async ({ page }) => {
    const state = freshState();
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    // peer edits arrive in contract state; the event nudges a re-pull
    state.overrides.push({ k: "30,50,30", b: 10 });
    await page.evaluate(() => {
      const mb = (
        window as never as {
          __mb: { sync: { handleEvent: (ev: { kind: string; value: string }) => void } };
        }
      ).__mb;
      mb.sync.handleEvent({ kind: "BlocksChanged", value: "some-peer" });
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
            .__mb.world.getBlock(30, 50, 30),
        ),
      )
      .toBe(10);
  });

  test("remote players appear in the player list and world", async ({ page }) => {
    const state = freshState({ players: [remotePlayer("peer-1", "Steve")] });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);

    // roster poll runs every 1.5s
    await expect(page.getByTestId("players")).toContainText("Steve", { timeout: 8000 });
    await expect(page.getByTestId("debug")).toContainText("peers 1");
  });

  test("a leaving player disappears from the roster", async ({ page }) => {
    const state = freshState({ players: [remotePlayer("peer-1", "Steve")] });
    await seedSession(page);
    await mockNode(page, state);
    await enterOnline(page);
    await expect(page.getByTestId("players")).toContainText("Steve", { timeout: 8000 });

    state.players = []; // peer left; next poll clears the roster
    await expect(page.getByTestId("players")).not.toContainText("Steve", { timeout: 8000 });
    await expect(page.getByTestId("debug")).toContainText("peers 0");
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

  test("falls back to offline when the node is unreachable", async ({ page }) => {
    await seedSession(page);
    await page.route("**/jsonrpc", (route) => route.abort());
    await page.route("**/sse**", (route) => route.abort());
    await page.goto("/");
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("debug")).toContainText("offline");
  });
});
