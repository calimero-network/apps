import { expect, test } from "@playwright/test";
import { CTX_ID, freshState, mockNode, MY_ID, NODE_URL } from "./helpers";

const fullHash =
  `#node_url=${NODE_URL}&access_token=sso-token&refresh_token=sso-refresh` +
  `&app-id=app-e2e&context_id=${CTX_ID}&executor_public_key=${MY_ID}&dev_mode=1`;

test.describe("desktop SSO auto-enter", () => {
  test("a full desktop hash skips the landing page entirely", async ({ page }) => {
    const state = freshState({ overrides: [{ k: "12,50,12", b: 3 }] });
    await mockNode(page, state);
    await page.goto(`/${fullHash}`);

    // no landing, no clicks — straight into the online game
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("landing")).toHaveCount(0);
    await expect(page.getByTestId("debug")).toContainText("online");

    // hash consumed + stripped (mero-chat SSO-strip lesson: captured first)
    expect(new URL(page.url()).hash).toBe("");
    expect(state.methods).toContain("world_meta");
    expect(state.methods).toContain("join");

    // and the shared world state actually loaded
    const b = await page.evaluate(() =>
      (window as never as { __mb: { world: { getBlock: (x: number, y: number, z: number) => number } } })
        .__mb.world.getBlock(12, 50, 12),
    );
    expect(b).toBe(3);
  });

  test("a web auth callback (tokens, no context) lands on the world picker", async ({ page }) => {
    const state = freshState();
    await mockNode(page, state);
    await page.addInitScript(({ nodeUrl }) => localStorage.setItem("mb-pending-node", nodeUrl), {
      nodeUrl: NODE_URL,
    });
    await page.goto("/#access_token=cb-token&refresh_token=cb-r&context_identity=cb-id");

    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByTestId("world-list")).toBeVisible(); // picker state
    expect(new URL(page.url()).hash).toBe("");
  });

  test("session survives a refresh after SSO (hash-less reload)", async ({ page }) => {
    const state = freshState();
    await mockNode(page, state);
    await page.goto(`/${fullHash}`);
    await page.waitForFunction(() => "__mb" in window);

    await page.goto("/"); // reload without any hash
    // still connected: landing shows the one-click enter button
    await expect(page.getByTestId("connect-btn")).toBeVisible();
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("debug")).toContainText("online");
  });
});
