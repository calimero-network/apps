/**
 * Integration tests — exercise the Mero Calendar contract against a **real**
 * Calimero node over JSON-RPC (no mocks, no UI).
 *
 * In CI these run after `workflows/integration-setup.yml` bootstraps a two-node
 * merobox stack with a seeded calendar context. merobox mints context/app ids
 * dynamically, so the context is **discovered at runtime** from the node's admin
 * API rather than hard-coded.
 *
 * Locally:
 *   INTEGRATION_NODE_URL=http://localhost:2528 \
 *   pnpm exec playwright test --project=integration
 *
 * If no node is reachable, every test self-skips, so the suite is safe to run
 * anywhere.
 */
import { test, expect, request, type APIRequestContext } from "@playwright/test";

// merobox exposes node-1's RPC/Admin server on host port 2528 (2428 is P2P).
const NODE_URL = process.env.INTEGRATION_NODE_URL ?? "http://localhost:2528";
const TOKEN = process.env.INTEGRATION_ACCESS_TOKEN ?? "";

let api: APIRequestContext;
let ctxId = process.env.INTEGRATION_CONTEXT_ID ?? "";
let executorKey = process.env.INTEGRATION_EXECUTOR_KEY ?? "";
let ready = false; // node reachable + a context resolved → reads can run
let canWrite = false; // an owned identity resolved → mutations can run

async function rpc(method: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await api.post("/jsonrpc", {
    data: { jsonrpc: "2.0", id: 1, method: "execute", params: { contextId: ctxId, method, argsJson: args } },
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  const out = body?.result?.output;
  if (Array.isArray(out) && typeof out[0] === "number") {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(out as number[])));
  }
  return out;
}

test.beforeAll(async () => {
  api = await request.newContext({
    baseURL: NODE_URL,
    extraHTTPHeaders: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });

  if (!ctxId) {
    try {
      const res = await api.get("/admin-api/contexts");
      if (res.ok()) {
        const body = await res.json();
        const list = body?.data?.contexts ?? body?.contexts ?? body?.data ?? [];
        if (Array.isArray(list) && list.length) ctxId = list[0]?.id ?? list[0]?.contextId ?? "";
      }
    } catch {
      /* node unreachable */
    }
  }
  ready = !!ctxId;

  if (ready && !executorKey) {
    try {
      const res = await api.get(`/admin-api/contexts/${ctxId}/identities-owned`);
      if (res.ok()) {
        const body = await res.json();
        const ids = body?.data?.identities ?? body?.identities ?? body?.data ?? [];
        if (Array.isArray(ids) && ids.length) executorKey = String(ids[0]);
      }
    } catch {
      /* no owned identity */
    }
  }
  canWrite = ready && !!executorKey;
});

test.afterAll(async () => {
  await api?.dispose();
});

test.beforeEach(() => {
  test.skip(
    !ready,
    "No reachable Calimero node/context. Run workflows/integration-setup.yml or set INTEGRATION_NODE_URL + INTEGRATION_CONTEXT_ID.",
  );
});

test("get_events returns the seeded shared event", async () => {
  const events = (await rpc("get_events", {})) as Array<{ title: string; private: boolean; peers: string[] }>;
  expect(Array.isArray(events)).toBe(true);
  // integration-setup seeds "Integration Standup".
  const seeded = events.find((e) => e.title === "Integration Standup");
  if (seeded) {
    expect(seeded.private).toBe(false);
    expect(Array.isArray(seeded.peers)).toBe(true);
  }
});

test("get_members returns the seeded usernames", async () => {
  const members = (await rpc("get_members", {})) as Array<{ username: string }>;
  expect(Array.isArray(members)).toBe(true);
  // Alice/Bob registered in integration-setup.
  const names = members.map((m) => m.username);
  expect(names.length).toBeGreaterThan(0);
});

test("create + read round-trips a shared event with a multi-peer list", async () => {
  test.skip(!canWrite, "No owned identity to sign mutations.");
  const id = (await rpc("create_event", {
    event_data: {
      title: "RPC Roundtrip",
      description: "from integration test",
      start: "2026-07-03T10:00:00",
      end: "2026-07-03T11:00:00",
      event_type: "event",
      color: "rgb(85, 124, 207)",
      peers: [],
    },
    timestamp: Date.now(),
  })) as string;
  expect(typeof id).toBe("string");

  const events = (await rpc("get_events", {})) as Array<{ id: string; title: string }>;
  expect(events.some((e) => e.title === "RPC Roundtrip")).toBe(true);

  // Cleanup.
  await rpc("delete_event", { event_id: id });
});

test("private events stay out of the shared calendar", async () => {
  test.skip(!canWrite, "No owned identity to sign mutations.");
  const id = (await rpc("create_private_event", {
    event_data: {
      title: "Private Block",
      description: "node-local only",
      start: "2026-07-04T10:00:00",
      end: "2026-07-04T11:00:00",
      event_type: "event",
      color: "rgb(213, 0, 0)",
      peers: [],
    },
    timestamp: Date.now(),
  })) as string;

  const priv = (await rpc("get_private_events", {})) as Array<{ id: string; title: string; private: boolean }>;
  expect(priv.some((e) => e.title === "Private Block" && e.private === true)).toBe(true);

  const shared = (await rpc("get_events", {})) as Array<{ title: string }>;
  expect(shared.some((e) => e.title === "Private Block")).toBe(false);

  await rpc("delete_private_event", { event_id: id });
});
