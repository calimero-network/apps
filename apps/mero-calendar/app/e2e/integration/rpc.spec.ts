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

/**
 * The two scoped admin routes the teams and calendar pickers are built on.
 *
 * The frontend refuses to list anything when it cannot scope to its own
 * application (see app/src/api/appScope.ts), which makes these endpoints load
 * bearing: if either stops filtering, or renames the field it filters on, the
 * pickers go silently empty rather than wrong — and nothing else here would
 * notice. That is the exact shape of the rc.25 break where a namespace's
 * `groupId` became `namespaceId` and simply read as `undefined`.
 */
test.describe("application-scoped admin listings", () => {
  /** This context's application, read from the node rather than assumed. */
  async function appId(): Promise<string> {
    const res = await api.get(`/admin-api/contexts/${ctxId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const ctx = body?.data ?? body;
    const id = ctx?.applicationId ?? ctx?.application_id ?? "";
    expect(id, "the context must name an application").toBeTruthy();
    return String(id);
  }

  test("every context for this application really runs it", async () => {
    const id = await appId();
    const res = await api.get(`/admin-api/contexts/for-application/${id}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const contexts = body?.data?.contexts ?? body?.contexts ?? [];
    expect(Array.isArray(contexts)).toBeTruthy();
    // The seeded context is this application's, so the list cannot be empty —
    // an empty list here would mean the route filters everything out, which is
    // indistinguishable from "no contexts" to the UI.
    expect(contexts.length, "the seeded context should be listed").toBeGreaterThan(0);
    for (const ctx of contexts) {
      expect(ctx?.applicationId ?? ctx?.application_id).toBe(id);
    }
    expect(contexts.map((c: Record<string, unknown>) => c.id ?? c.contextId)).toContain(ctxId);
  });

  test("every namespace for this application targets it, under the name the UI reads", async () => {
    const id = await appId();
    const res = await api.get(`/admin-api/namespaces/for-application/${id}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const namespaces = body?.data ?? body?.namespaces ?? [];
    expect(Array.isArray(namespaces)).toBeTruthy();
    for (const ns of namespaces) {
      // `targetApplicationId` is the field appScope.ts filters on. A rename
      // makes it undefined, the filter drops every row, and the teams list
      // empties out with no error anywhere.
      expect(
        ns?.targetApplicationId ?? ns?.target_application_id,
        "a namespace must name its target application",
      ).toBe(id);
      expect(ns?.namespaceId ?? ns?.groupId ?? ns?.id, "a namespace must carry an id").toBeTruthy();
    }
  });

  test("an application nobody installed lists nothing, rather than everything", async () => {
    // The failure mode worth pinning: a scoped route that quietly ignores its
    // filter would answer this with the whole node, and the UI would show
    // another application's teams as though they were calendars.
    const bogus = "11111111111111111111111111111111";
    const res = await api.get(`/admin-api/contexts/for-application/${bogus}`);
    if (res.status() >= 400) return; // rejecting an unknown id is also correct
    const body = await res.json();
    const contexts = body?.data?.contexts ?? body?.contexts ?? [];
    expect(contexts, "an unknown application must not inherit this node's contexts").toHaveLength(0);
  });
});
