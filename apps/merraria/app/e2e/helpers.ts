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
