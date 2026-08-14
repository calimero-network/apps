// Mocked-node helpers — twin of mero-blocks', with set_tiles/TilesChanged.
// Every route pattern is scoped to the fake node ORIGIN (a bare "events" glob
// would swallow the app's own /src/net/events.ts module request from Vite).

import { Page } from "@playwright/test";

export const NODE_URL = "http://127.0.0.1:7778";
export const CTX_ID = "ctx-e2e";
export const MY_ID = "test-identity";

export interface MockNodeState {
  seed: number;
  overrides: { k: string; t: number }[];
  players: Record<string, unknown>[];
  setTileCalls: { edits: { x: number; y: number; t: number }[]; now: number }[];
  methods: string[];
}

const outputBytes = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value ?? null)));

export async function mockNode(page: Page, state: MockNodeState): Promise<void> {
  await page.route(`${NODE_URL}/**`, (route) => route.abort());
  await page.route(`${NODE_URL}/admin-api/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [MY_ID] }),
    }),
  );
  await page.route(`${NODE_URL}/jsonrpc`, async (route) => {
    const body = route.request().postDataJSON() as {
      params: { method: string; argsJson: Record<string, unknown> };
    };
    const method = body.params.method;
    state.methods.push(method);
    let value: unknown = null;
    switch (method) {
      case "world_meta":
        value = { name: "e2e world", seed: state.seed, createdAt: 1720000000 };
        break;
      case "get_overrides":
        value = state.overrides;
        break;
      case "get_players":
        value = state.players;
        break;
      case "set_tiles": {
        const args = body.params.argsJson as unknown as MockNodeState["setTileCalls"][number];
        state.setTileCalls.push(args);
        value = args.edits.length;
        break;
      }
      case "join":
      case "heartbeat":
      case "leave":
        value = null;
        break;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: outputBytes(value), logs: [] } }),
    });
  });
}

export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ nodeUrl, ctxId, myId }) => {
      localStorage.setItem(
        "mt-session",
        JSON.stringify({
          nodeUrl,
          contextId: ctxId,
          applicationId: "app-e2e",
          executorPublicKey: myId,
          devMode: true,
        }),
      );
      localStorage.setItem(
        "mero-tokens",
        JSON.stringify({ access_token: "e2e-token", refresh_token: "r", expires_at: "" }),
      );
    },
    { nodeUrl: NODE_URL, ctxId: CTX_ID, myId: MY_ID },
  );
}

export function freshState(partial: Partial<MockNodeState> = {}): MockNodeState {
  return { seed: 4242, overrides: [], players: [], setTileCalls: [], methods: [], ...partial };
}

export const remotePlayer = (id: string, name: string, x = 190) => ({
  id,
  name,
  x,
  y: 55,
  dir: 1,
  sel: 0,
  online: true,
});

export async function enterOnline(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("connect-btn").click();
  await page.waitForFunction(() => "__mt" in window);
}

// ---- world picker / admin-API mocks -----------------------------------
// The picker states (logged into a node, no world yet) and the admin routes
// world creation walks are shared by landing.spec and auth.spec.

export const PACKAGE_NAME = "com.calimero.merraria";
export const APP_ID = "app-e2e";
export const NS_ID = "ns-e2e";
export const GROUP_ID = "grp-e2e";

/**
 * Logged into a node with no world chosen — the state a web callback leaves.
 * Init scripts re-run on every navigation, so this must NOT clobber a session
 * the test has since built (creating a world and then reloading is a real
 * flow); it seeds only when there is nothing there.
 */
export function seedAuthOnly(page: Page): Promise<void> {
  return page.addInitScript(
    ({ nodeUrl }) => {
      if (localStorage.getItem("mt-session")) return;
      localStorage.setItem(
        "mt-session",
        JSON.stringify({
          nodeUrl,
          contextId: null,
          applicationId: null,
          executorPublicKey: null,
          devMode: false,
        }),
      );
      localStorage.setItem(
        "mero-tokens",
        JSON.stringify({ access_token: "e2e-token", refresh_token: "r", expires_at: "" }),
      );
    },
    { nodeUrl: NODE_URL },
  );
}

/** request bodies captured by mockAdmin for assertions */
export interface CapturedBodies {
  namespace?: Record<string, unknown>;
  group?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface AdminOverrides {
  /** replace the /admin-api/applications payload (default: our package) */
  applications?: unknown;
}

/**
 * Mock the admin API world creation walks: namespace → open subgroup → context.
 * NOTE: register AFTER mockNode — later routes win, and these must shadow
 * mockNode's generic admin-api handler for /applications and /contexts.
 */
export async function mockAdmin(
  page: Page,
  contexts: Record<string, unknown>[],
  captured: CapturedBodies,
  overrides: AdminOverrides = {},
): Promise<void> {
  await page.route(`${NODE_URL}/admin-api/namespaces/for-application/*`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await page.route(`${NODE_URL}/admin-api/namespaces`, (route) => {
    captured.namespace = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { namespaceId: NS_ID } }),
    });
  });
  await page.route(`${NODE_URL}/admin-api/namespaces/${NS_ID}/groups`, (route) => {
    captured.group = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { groupId: GROUP_ID } }),
    });
  });
  await page.route(`${NODE_URL}/admin-api/applications`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        overrides.applications ?? { data: { apps: [{ id: APP_ID, package: PACKAGE_NAME }] } },
      ),
    }),
  );
  await page.route(`${NODE_URL}/admin-api/contexts`, (route) => {
    if (route.request().method() === "POST") {
      captured.context = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { contextId: "ctx-created", memberPublicKey: "pk-me" } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { contexts } }),
    });
  });
  await page.route(`${NODE_URL}/admin-api/contexts/*/join`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
}
