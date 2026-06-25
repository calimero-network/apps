/**
 * Integration tests — exercise the MeroPixArt contract against a **real
 * Calimero node** over JSON-RPC (no mocks, no UI).
 *
 * In CI these run after `workflows/integration-setup.yml` bootstraps a two-node
 * merobox stack with a "Integration Project" context (800×600) seeded with a
 * "Background" layer and members Alice/Bob. Because merobox mints context/app
 * ids dynamically, the context is **discovered at runtime** from the node's
 * admin API rather than hard-coded.
 *
 * Locally you can point them at any running node:
 *   INTEGRATION_NODE_URL=http://localhost:2460 \
 *   INTEGRATION_CONTEXT_ID=<ctx> \
 *   INTEGRATION_ACCESS_TOKEN=<jwt> \
 *   pnpm exec playwright test --project=integration
 *
 * If no node is reachable (and nothing was discovered) every test self-skips,
 * so the suite is safe to run anywhere.
 */
import { test, expect, request, type APIRequestContext } from "@playwright/test";

// merobox maps node-1's server port to 2428 on the host (see scripts/workflows.sh).
const NODE_URL = process.env.INTEGRATION_NODE_URL ?? "http://localhost:2428";
const TOKEN = process.env.INTEGRATION_ACCESS_TOKEN ?? "";

let api: APIRequestContext;
let ctxId = process.env.INTEGRATION_CONTEXT_ID ?? "";
let executorKey = process.env.INTEGRATION_EXECUTOR_KEY ?? "";
let ready = false; // node reachable + a context resolved → reads can run
let canWrite = false; // an owned identity resolved → mutations can run

test.beforeAll(async () => {
  api = await request.newContext({
    baseURL: NODE_URL,
    extraHTTPHeaders: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });

  // Discover the project context if it wasn't supplied explicitly.
  if (!ctxId) {
    try {
      const res = await api.get("/admin-api/contexts");
      if (res.ok()) {
        const body = await res.json();
        const list = body?.data?.contexts ?? body?.contexts ?? body?.data ?? [];
        if (Array.isArray(list) && list.length) {
          ctxId = list[0]?.id ?? list[0]?.contextId ?? "";
        }
      }
    } catch {
      /* node unreachable — handled by the ready flag below */
    }
  }
  ready = !!ctxId;

  // Resolve an owned identity to sign mutations (the canonical executor key).
  if (ready && !executorKey) {
    try {
      const res = await api.get(`/admin-api/contexts/${ctxId}/identities-owned`);
      if (res.ok()) {
        const body = await res.json();
        const ids = body?.data ?? body ?? [];
        if (Array.isArray(ids) && ids.length) executorKey = String(ids[0]);
      }
    } catch {
      /* no owned identity — writes will self-skip */
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
    "No reachable Calimero node/context. Run workflows/integration-setup.yml " +
      "or set INTEGRATION_NODE_URL + INTEGRATION_CONTEXT_ID.",
  );
});

/** Call a contract method via the node's `execute` JSON-RPC. */
async function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const params: Record<string, unknown> = { contextId: ctxId, method, argsJson: args };
  if (executorKey) params.executorPublicKey = executorKey;
  const res = await api.post("/jsonrpc", {
    data: { jsonrpc: "2.0", id: 1, method: "execute", params },
  });
  const body = await res.json();
  if (body.error) throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error));
  return parseOutput<T>(body.result?.output);
}

/** merod's `output` is either a u8[] byte array (older nodes) or parsed JSON. */
function parseOutput<T>(out: unknown): T {
  if (out === null || out === undefined) return null as T;
  if (typeof out === "string") {
    try { return JSON.parse(out) as T; } catch { return out as T; }
  }
  if (Array.isArray(out)) {
    if (out.length === 0) return null as T;
    if (typeof out[0] !== "number") return out as T; // already JSON objects
    const text = Buffer.from(out as number[]).toString("utf8");
    return JSON.parse(text) as T;
  }
  if (typeof out === "object") return out as T;
  return null as T;
}

// ── Document ────────────────────────────────────────────────────────────────

test.describe("Document", () => {
  test("get_document returns the seeded 800×600 project", async () => {
    const doc = await rpc<{ name: string; width: number; height: number }>("get_document", {});
    expect(doc).toBeTruthy();
    expect(doc.width).toBe(800);
    expect(doc.height).toBe(600);
    expect(doc.name).toBe("Integration Project");
  });
});

// ── Layers ────────────────────────────────────────────────────────────────────

test.describe("Layers", () => {
  test("get_layers includes the seeded Background layer", async () => {
    const layers = await rpc<{ id: string; name: string; kind: string }[]>("get_layers", {});
    expect(Array.isArray(layers)).toBe(true);
    const bg = layers?.find((l) => l.id === "layer-1");
    expect(bg).toBeDefined();
    expect(bg?.name).toBe("Background");
    expect(bg?.kind).toBe("raster");
  });

  // Mutations share node state, so run them in order.
  test.describe("raster layer round-trip", () => {
    test.describe.configure({ mode: "serial" });
    test.beforeEach(() => test.skip(!canWrite, "no owned identity to sign mutations"));

    const id = `it-layer-${Date.now()}`;
    const newLayer = {
      id,
      name: "Integration Layer",
      kind: "raster",
      layerIndex: 99,
      visible: true,
      locked: false,
      opacity: 100,
      blendMode: "normal",
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      rotation: 0,
      scaleX: 100,
      scaleY: 100,
      fill: "#abcdef",
      adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false },
      createdBy: "integration-test",
      createdAt: 1751953100,
      updatedAt: 1751953100,
    };

    test("add_layer creates the layer", async () => {
      await rpc("add_layer", { layer: newLayer });
      const layers = await rpc<{ id: string; name: string }[]>("get_layers", {});
      const found = layers?.find((l) => l.id === id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Integration Layer");
    });

    test("update_layer repositions it", async () => {
      await rpc("update_layer", {
        id,
        name: null, visible: null, locked: null, opacity: null, blend_mode: null,
        x: 200, y: 250, width: null, height: null,
        rotation: null, scale_x: null, scale_y: null, fill: null,
        updated_at: 1751953200,
      });
      const layers = await rpc<{ id: string; x: number; y: number }[]>("get_layers", {});
      const found = layers?.find((l) => l.id === id);
      expect(found?.x).toBe(200);
      expect(found?.y).toBe(250);
    });

    test("delete_layer removes it", async () => {
      await rpc("delete_layer", { id });
      const layers = await rpc<{ id: string }[]>("get_layers", {});
      expect(layers?.find((l) => l.id === id)).toBeUndefined();
    });
  });
});

// ── Members ────────────────────────────────────────────────────────────────────

test.describe("Members", () => {
  test("get_members includes the seeded Alice", async () => {
    const members = await rpc<{ id: string; username: string }[]>("get_members", {});
    expect(Array.isArray(members)).toBe(true);
    const usernames = (members ?? []).map((m) => m.username);
    expect(usernames).toContain("Alice");
    // every member carries a server-derived id
    for (const m of members ?? []) expect(m.id).toBeTruthy();
  });
});

// ── Cursors ────────────────────────────────────────────────────────────────────

test.describe("Cursors", () => {
  test.beforeEach(() => test.skip(!canWrite, "no owned identity to sign mutations"));

  test("update_cursor stores the caller's position", async () => {
    await rpc("update_cursor", { x: 321, y: 654, updated_at: 1751953300 });
    const cursors = await rpc<{ identity?: string; x: number; y: number }[]>("get_cursors", {});
    const c = cursors?.find((cur) => cur.x === 321 && cur.y === 654);
    expect(c).toBeDefined();
  });
});
