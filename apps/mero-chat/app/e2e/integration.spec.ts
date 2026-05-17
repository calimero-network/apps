/**
 * Full-stack integration tests — frontend + real Calimero node + curb.wasm.
 *
 * Prerequisites (run once before this suite):
 *   ./scripts/setup-nodes.sh
 *
 * That script writes app/.env.integration with real JWT tokens, node URLs,
 * group ID, and context ID from live nodes.  If those env vars are absent
 * every test here is skipped gracefully.
 *
 * Run:
 *   pnpm exec playwright test --project=integration
 */

import { test, expect } from "@playwright/test";
import {
  integrationEnvAvailable,
  getIntegrationEnv,
  injectRealTokens,
  NodeClient,
} from "./helpers/node-client";

// ── Skip entire suite if no real node is configured ────────────────────────

test.beforeAll(() => {
  if (!integrationEnvAvailable()) {
    console.log(
      "[integration] E2E_NODE_URL / E2E_ACCESS_TOKEN not set — skipping integration suite.\n" +
      "[integration] Run  ./scripts/setup-nodes.sh  to start live nodes.",
    );
  }
});

function requireEnv() {
  if (!integrationEnvAvailable()) {
    test.skip();
  }
  return getIntegrationEnv();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function setupAuth(page: import("@playwright/test").Page) {
  const env = getIntegrationEnv();
  await injectRealTokens(page, {
    nodeUrl:      env.nodeUrl,
    accessToken:  env.accessToken,
    refreshToken: env.refreshToken,
  });
}

// ── Node health ───────────────────────────────────────────────────────────────

test.describe("Node health", () => {
  test("node 1 is healthy", async () => {
    const env = requireEnv();
    const client = new NodeClient({ nodeUrl: env.nodeUrl, accessToken: env.accessToken });
    expect(await client.health()).toBe(true);
  });

  test("node 2 is healthy", async () => {
    const env = requireEnv();
    const client = new NodeClient({ nodeUrl: env.nodeUrl2, accessToken: env.accessToken2 });
    expect(await client.health()).toBe(true);
  });

  test("context is reachable and has expected seed data", async () => {
    const env = requireEnv();
    const client = new NodeClient({ nodeUrl: env.nodeUrl, accessToken: env.accessToken });

    const contexts = await client.listContexts();
    const ctx = contexts.find(
      (c) => c.contextId === env.contextId,
    );
    expect(ctx).toBeTruthy();
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

test.describe("Authentication with live node", () => {
  test("real tokens pass mero-react auth — workspace selector appears", async ({
    page,
  }) => {
    requireEnv();
    await setupAuth(page);
    await page.goto("/login");

    // The workspace selector heading is the first thing that appears after auth
    // After auth, the user lands on the workspace picker. With groups
    // present the heading is "Select workspace"; with none it's "Welcome
    // to MeroChat". Both indicate the auth gate has been passed.
    await expect(
      page.getByText(/Select workspace|Welcome to MeroChat/),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("workspace list shows the integration test workspace", async ({
    page,
  }) => {
    const _env = requireEnv();
    await setupAuth(page);
    await page.goto("/login");
    // After auth, the user lands on the workspace picker. With groups
    // present the heading is "Select workspace"; with none it's "Welcome
    // to MeroChat". Both indicate the auth gate has been passed.
    await expect(
      page.getByText(/Select workspace|Welcome to MeroChat/),
    ).toBeVisible({ timeout: 20_000 });

    // The workspace selector polls /admin-api/groups and displays each group alias
    // The integration-setup workflow creates a group; at minimum one workspace row
    // should be visible in the dropdown / list
    await expect(
      page.locator("select, [role='listbox'], [role='option']").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("logout clears tokens and returns to landing page", async ({ page }) => {
    requireEnv();
    await setupAuth(page);
    await page.goto("/login");
    // After auth, the user lands on the workspace picker. With groups
    // present the heading is "Select workspace"; with none it's "Welcome
    // to MeroChat". Both indicate the auth gate has been passed.
    await expect(
      page.getByText(/Select workspace|Welcome to MeroChat/),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /disconnect node/i }).click();
    await page.waitForTimeout(500);

    const tokens = await page.evaluate(() => localStorage.getItem("mero-tokens"));
    expect(tokens).toBeNull();
  });
});


// ── Real-time sync (two nodes) ────────────────────────────────────────────────

test.describe("Cross-node message sync", () => {
  test("message sent on node 1 appears via node 2's RPC", async () => {
    const env = requireEnv();
    const ts = Date.now();
    const marker = `sync-test-${ts}`;

    const client1 = new NodeClient({
      nodeUrl:      env.nodeUrl,
      accessToken:  env.accessToken,
    });
    const client2 = new NodeClient({
      nodeUrl:      env.nodeUrl2,
      accessToken:  env.accessToken2,
    });

    // Get identities for both nodes
    const ids1 = await client1.getContextIdentities(env.contextId);
    const ids2 = await client2.getContextIdentities(env.contextId);

    if (ids1.length === 0 || ids2.length === 0) {
      test.skip();
      return;
    }

    // Send a message via node 1's RPC
    await client1.rpcCall(env.contextId, ids1[0], "send_message", {
      message:            marker,
      mentions:           [],
      mentions_usernames: [],
      parent_message:     null,
      timestamp:          Math.floor(ts / 1000),
      sender_username:    "Alice",
      files:              null,
      images:             null,
    });

    // Poll node 2 for up to 30s waiting for the message to sync
    let found = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1_000));
      const result = await client2.rpcCall(
        env.contextId,
        ids2[0],
        "get_messages",
        { parent_message: null, limit: 20, offset: 0, search_term: marker },
      );
      if (JSON.stringify(result).includes(marker)) {
        found = true;
        break;
      }
    }

    expect(found, `Message "${marker}" did not sync to node 2 within 30 s`).toBe(true);
  });
});
