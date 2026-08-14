import type { Page, Route } from "@playwright/test";

// ── Shared mocked-node harness ───────────────────────────────────────────────
//
// The `mocked` Playwright project runs the real app against a fake node: auth is
// injected into localStorage, and every route the editor touches is fulfilled
// here. That makes the suite fast and hermetic, at the cost of one rule you must
// keep in mind when writing specs:
//
//   the mock node does not remember anything.
//
// `get_layers` always answers with whatever `layerState` holds, and mutations
// (add_layer, move_layers, update_transform…) are recorded but do not change it.
// The app is optimistic — it writes to its own store first — so the UI behaves
// correctly; what you must not do is reload the page and expect your edits back.
// Use `rpcLog(page)` to assert that the right calls were made instead.

export interface RpcRecord {
  method: string;
  args: Record<string, unknown>;
}

/** JSON-RPC success envelope, with the payload as a UTF-8 byte array (the shape
 *  older merod versions return, which the client still supports). */
export function rpcBytes(value: unknown): string {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: bytes, logs: [] } });
}

export const TEST_MEMBER = {
  id: "test-identity", username: "Tester", avatar: null, joinedAt: 1000,
};

export interface MockOptions {
  /** Contract methods this node's installed app does NOT have — answered with the
   *  runtime's `method "x" not found`, so the frontend's compatibility fallbacks
   *  can be exercised against an older app build. */
  missingMethods?: string[];
  /** Document metadata `get_document` answers with. */
  doc?: Partial<{
    name: string; description: string; width: number; height: number;
    background: string; layerCount: number; memberCount: number; owner: string | null;
  }>;
  /** Layers `get_layers` answers with. */
  layers?: unknown[];
  /** Role `my_role` answers with. */
  role?: "admin" | "editor" | "viewer";
}

/** Inject tokens so the app lands straight in the editor. */
export async function injectAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // JWT payload {"sub":"test-identity"} — matches TEST_MEMBER.id
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "fake-refresh",
      expires_at: Date.now() + 3600_000,
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2460");
    localStorage.setItem("mero:application_id", "app-1");
    localStorage.setItem("mp-username", "Tester");
  });
}

/**
 * Every route the app touches. Returns the RPC log so a spec can assert on what
 * the UI actually asked the node to do — which, with a stateless mock, is the
 * real contract being tested.
 */
export async function mockNode(page: Page, opts: MockOptions = {}): Promise<RpcRecord[]> {
  const log: RpcRecord[] = [];

  const document = {
    name: "Test Project", description: "", width: 800, height: 600,
    background: "#00000000", layerCount: 0, memberCount: 1, owner: "test-identity",
    ...opts.doc,
  };
  const layers = opts.layers ?? [];
  const role = opts.role ?? "admin";
  const missing = new Set(opts.missingMethods ?? []);

  // mero-react ≥4.1.1 probes HEAD /auth/validate; older builds probed contexts.
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));
  await page.route("**/admin-api/contexts", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: { contexts: [] } }),
  }));
  await page.route("**/admin-api/contexts/**/identities-owned", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: ["test-identity"] }),
  }));
  await page.route("**/admin-api/contexts/*/join", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: { memberPublicKey: "test-identity" } }),
  }));

  // Blob upload/download: the showcase loader pushes one PNG per painted layer.
  await page.route("**/admin-api/blobs**", (route: Route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ data: { blob_id: `blob-${Math.random().toString(36).slice(2, 10)}` } }),
      });
    }
    // A GET for a blob we never really stored: 404 is what the node would say,
    // and the editor treats a missing blob as "no pixels yet".
    return route.fulfill({ status: 404, body: "" });
  });

  await page.route("**/jsonrpc", (route) => {
    const body = route.request().postDataJSON() as {
      params?: { method?: string; argsJson?: Record<string, unknown> };
    };
    const method = body?.params?.method ?? "";
    log.push({ method, args: body?.params?.argsJson ?? {} });

    if (missing.has(method)) {
      // Exactly what calimero-runtime returns for an export the WASM lacks:
      // `#[error("method {name:?} not found")]`.
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          error: { code: -32000, message: `method "${method}" not found` },
        }),
      });
    }

    let value: unknown = null;
    switch (method) {
      case "get_document": value = document; break;
      case "get_layers": value = layers; break;
      case "get_members": value = [TEST_MEMBER]; break;
      case "get_cursors": value = []; break;
      case "my_role": value = role; break;
      default: value = null; // mutations acknowledge without persisting
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: rpcBytes(value) });
  });

  // Governance endpoints used by the projects page / settings modal.
  await page.route("**/admin-api/groups/*/subgroups", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { subgroups: [] } }),
  }));
  await page.route("**/admin-api/groups/*/contexts", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }),
  }));
  await page.route("**/admin-api/groups/*/members", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }),
  }));

  // SSE would drive a refetch that clobbers the optimistic local state.
  await page.route("**/events**", (route) => route.abort());
  await page.route("**/sse**", (route) => route.abort());

  return log;
}

/** Open the editor on a mocked project and wait for it to be interactive. */
export async function openEditor(
  page: Page, opts: MockOptions & { query?: string } = {},
): Promise<RpcRecord[]> {
  await injectAuth(page);
  const log = await mockNode(page, opts);
  await page.goto(`/teams/team-1/projects/project-1${opts.query ?? ""}`);
  await page.getByTestId("toolbar").waitFor({ state: "visible", timeout: 10_000 });
  return log;
}

/** Every recorded call to one contract method. */
export function callsTo(log: RpcRecord[], method: string): RpcRecord[] {
  return log.filter((r) => r.method === method);
}

/**
 * Wait until `method` has been called at least `count` times.
 *
 * Necessary because the editor is optimistic: it updates its own state and
 * returns, then the RPC flies. Asserting on the log straight after a click reads
 * it before the request has been intercepted, which looks exactly like "the app
 * never persisted anything".
 */
export async function waitForCalls(
  log: RpcRecord[], method: string, count = 1, timeout = 5_000,
): Promise<RpcRecord[]> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hits = callsTo(log, method);
    if (hits.length >= count) return hits;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `waitForCalls: expected ${count}× "${method}" within ${timeout}ms, saw `
    + `${callsTo(log, method).length}. Recorded: ${log.map((r) => r.method).join(", ")}`,
  );
}
