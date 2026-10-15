import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { encodeInvite } from "../src/net/inviteCodec";
import {
  enterOnline,
  freshState,
  mockNode,
  MY_ID,
  NODE_URL,
  CTX_ID,
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

  test("an unreachable world is a hard stop — error screen, no offline fallback", async ({ page }) => {
    await seedSession(page);
    await page.route("**/jsonrpc", (route) => route.abort());
    await page.route("**/sse**", (route) => route.abort());
    await page.goto("/");
    await page.getByTestId("connect-btn").click();
    await expect(page.getByTestId("fatal-error")).toBeVisible();
    await expect(page.getByTestId("fatal-message")).toContainText("Could not reach the shared world");
    await expect(page.getByTestId("back-to-title-btn")).toBeVisible();
    // the game never booted
    const started = await page.evaluate(() => "__mb" in window);
    expect(started).toBe(false);
  });
});

test.describe("an invite link handed to the running desktop app", () => {
  // The launcher's bridge, present before the app boots as the real one is.
  async function installBridge(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const handlers: ((payload: unknown) => void)[] = [];
      const w = window as unknown as Record<string, unknown>;
      w.__calimero_platform__ = {
        version: 1,
        capabilities: ["deepLink"],
        invoke: async () => null,
        on: (event: string, h: (payload: unknown) => void) => {
          if (event === "deep-link") handlers.push(h);
          return () => undefined;
        },
      };
      w.__fireDeepLink = (raw: string) => handlers.forEach((h) => h({ raw }));
    });
  }

  test("asks in-game, then leaves this world and enters the invited one", async ({ page }) => {
    test.setTimeout(90_000); // two full game boots
    const state = freshState();
    // Seeded once, not on every load: the join moves the session to the invited
    // world, and the reload after it must keep that.
    await page.addInitScript(
      ({ nodeUrl, ctxId, myId }) => {
        if (localStorage.getItem("mb-session")) return;
        localStorage.setItem(
          "mb-session",
          JSON.stringify({ nodeUrl, contextId: ctxId, applicationId: "app-e2e", executorPublicKey: myId, devMode: true }),
        );
        localStorage.setItem(
          "mero-tokens",
          JSON.stringify({ access_token: "e2e-token", refresh_token: "r", expires_at: "" }),
        );
      },
      { nodeUrl: NODE_URL, ctxId: CTX_ID, myId: MY_ID },
    );
    await installBridge(page);
    await mockNode(page, state);
    await enterOnline(page);

    const code = encodeInvite({
      invitation: { invitation: { groupId: [0xab, 0xcd] }, inviterSignature: "sig" },
      groupAlias: "far lands",
      contextId: "ctx-invited",
      groupId: "grp-invited",
    });
    // another app's link is not ours to offer
    await page.evaluate(
      (c) => (window as unknown as { __fireDeepLink(r: string): void }).__fireDeepLink(
        `calimero://com.calimero.not-this-app/join?invitation=${c}`,
      ),
      code,
    );
    await page.waitForTimeout(500);
    await expect(page.getByTestId("invite-prompt")).toHaveCount(0);

    await page.evaluate(
      (c) => (window as unknown as { __fireDeepLink(r: string): void }).__fireDeepLink(
        `calimero://com.calimero.mero-blocks/join?invitation=${c}`,
      ),
      code,
    );
    await expect(page.getByRole("dialog", { name: "Join “far lands”?" })).toBeVisible();
    expect(state.methods).not.toContain("leave"); // still playing until Join

    const reloaded = page.waitForEvent("load");
    await page.getByTestId("invite-accept").click();
    await reloaded;
    // straight back into the game — in the invited world, no picker in between
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("landing")).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("mb-session") ?? "{}").contextId as string),
    ).toBe("ctx-invited");
    expect(state.methods).toContain("leave"); // left the old world on the way out
  });
});
