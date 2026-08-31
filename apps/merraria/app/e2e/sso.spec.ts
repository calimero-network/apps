import { expect, test } from "@playwright/test";
import { CTX_ID, freshState, mockNode, MY_ID, NODE_URL } from "./helpers";

const fullHash =
  `#node_url=${NODE_URL}&access_token=sso-token&refresh_token=sso-refresh` +
  `&app-id=app-e2e&context_id=${CTX_ID}&executor_public_key=${MY_ID}&dev_mode=1`;

test.describe("desktop SSO auto-enter", () => {
  test("a full desktop hash skips the landing page entirely", async ({ page }) => {
    const state = freshState({ overrides: [{ k: "50,60", t: 3 }] });
    await mockNode(page, state);
    await page.goto(`/${fullHash}`);

    // no landing, no clicks — straight into the online game
    await page.waitForFunction(() => "__mt" in window);
    await expect(page.getByTestId("landing")).toHaveCount(0);
    await expect(page.getByTestId("debug")).toContainText("online");

    // hash consumed + stripped (mero-chat SSO-strip lesson: captured first)
    expect(new URL(page.url()).hash).toBe("");
    expect(state.methods).toContain("world_meta");
    expect(state.methods).toContain("join");

    // and the shared world state actually loaded
    const t = await page.evaluate(() =>
      (window as never as { __mt: { world: { getTile: (x: number, y: number) => number } } })
        .__mt.world.getTile(50, 60),
    );
    expect(t).toBe(3);
  });

  test("an expired desktop token is refreshed before entering the world", async ({ page }) => {
    const state = freshState();
    await mockNode(page, state);
    let refreshBody: { access_token?: string; refresh_token?: string } | null = null;
    await page.route(`${NODE_URL}/auth/refresh`, (route) => {
      refreshBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { access_token: "fresh-at", refresh_token: "fresh-rt" } }),
      });
    });
    await page.goto(`/${fullHash}&expires_at=${Date.now() - 60_000}`);

    // still lands straight in the online world — the stale token was swapped
    await page.waitForFunction(() => "__mt" in window);
    await expect(page.getByTestId("landing")).toHaveCount(0);
    await expect(page.getByTestId("debug")).toContainText("online");
    expect(refreshBody!.access_token).toBe("sso-token");
    expect(refreshBody!.refresh_token).toBe("sso-refresh");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mero-tokens")!));
    expect(stored.access_token).toBe("fresh-at");
  });

  test("a web auth callback (tokens, no context) lands on the world picker", async ({ page }) => {
    const state = freshState();
    await mockNode(page, state);
    await page.addInitScript(({ nodeUrl }) => localStorage.setItem("mt-pending-node", nodeUrl), {
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
    await page.waitForFunction(() => "__mt" in window);

    await page.goto("/"); // reload without any hash
    // still connected: landing shows the one-click enter button
    await expect(page.getByTestId("connect-btn")).toBeVisible();
    await page.getByTestId("connect-btn").click();
    await page.waitForFunction(() => "__mt" in window);
    await expect(page.getByTestId("debug")).toContainText("online");
  });
});
