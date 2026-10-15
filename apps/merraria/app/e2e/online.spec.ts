import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { encodeInvite } from "../src/net/inviteCodec";
import { CTX_ID, enterOnline, freshState, mockNode, MY_ID, NODE_URL, remotePlayer, seedSession } from "./helpers";

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
        if (localStorage.getItem("mt-session")) return;
        localStorage.setItem(
          "mt-session",
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
    const fire = (raw: string) =>
      page.evaluate((r) => (window as unknown as { __fireDeepLink(r: string): void }).__fireDeepLink(r), raw);

    // another app's link is not ours to offer
    await fire(`calimero://com.calimero.not-this-app/join?invitation=${code}`);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("invite-prompt")).toHaveCount(0);

    await fire(`calimero://com.calimero.merraria/join?invitation=${code}`);
    await expect(page.getByRole("dialog", { name: "Join “far lands”?" })).toBeVisible();
    expect(state.methods).not.toContain("leave"); // still playing until Join

    const reloaded = page.waitForEvent("load");
    await page.getByTestId("invite-accept").click();
    await reloaded;
    // straight back into the game — in the invited world, no picker in between
    await page.waitForFunction(() => "__mt" in window);
    await expect(page.getByTestId("landing")).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("mt-session") ?? "{}").contextId as string),
    ).toBe("ctx-invited");
    expect(state.methods).toContain("leave"); // left the old world on the way out
  });
});
