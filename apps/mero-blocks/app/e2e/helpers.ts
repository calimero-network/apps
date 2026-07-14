// Shared mocked-node helpers (mero-design e2e patterns: sse/jsonrpc route
// mocks, byte-array outputs, localStorage session seeding).

import { Page } from "@playwright/test";

export const NODE_URL = "http://127.0.0.1:7777";
export const CTX_ID = "ctx-e2e";
export const MY_ID = "test-identity";

export interface MockNodeState {
  seed: number;
  overrides: { k: string; b: number }[];
  players: Record<string, unknown>[];
  /** every set_blocks batch the app sent */
  setBlockCalls: { edits: { x: number; y: number; z: number; b: number }[]; now: number }[];
  /** every rpc method invoked */
  methods: string[];
}

const outputBytes = (value: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value ?? null)));

/**
 * Route-mock a Calimero node: sse aborted, jsonrpc served from `state`.
 * IMPORTANT: every pattern is scoped to the fake node ORIGIN — a bare
 * "sse"/"events" glob (mero-design style) would also swallow the app's own
 * module requests from the Vite dev server (src/net/events.ts) and brick boot.
 */
export async function mockNode(page: Page, state: MockNodeState): Promise<void> {
  // registered first => matched last: anything unhandled on the node origin dies
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
      case "set_blocks": {
        const args = body.params.argsJson as unknown as MockNodeState["setBlockCalls"][number];
        state.setBlockCalls.push(args);
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

/** Seed a desktop-SSO-equivalent session before the app boots. */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ nodeUrl, ctxId, myId }) => {
      localStorage.setItem(
        "mb-session",
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
  return {
    seed: 4242,
    overrides: [],
    players: [],
    setBlockCalls: [],
    methods: [],
    ...partial,
  };
}

export const remotePlayer = (id: string, name: string, x = 60) => ({
  id,
  name,
  x,
  y: 40,
  z: 60,
  yaw: 0,
  pitch: 0,
  sel: 0,
  online: true,
});

/** window.__mb test handle */
export interface MbHandle {
  editBlock: (x: number, y: number, z: number, b: number) => void;
  getOverrides: () => Record<string, number>;
}

export async function enterOnline(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("connect-btn").click();
  await page.waitForFunction(() => "__mb" in window);
}
