/**
 * Blob integration tests — require a real Calimero node at localhost:2430.
 *
 * Covers:
 *  1. Blob upload API — response has snake_case blob_id (not blobId)
 *  2. Upload with context_id announces blob to network
 *  3. Blob can be downloaded back intact
 *  4. Image element stores blobId in WASM and round-trips correctly
 *  5. Browser fetches the blob after canvas load (no "[MeroDesign] blob fetch failed")
 *  6. Blob is still fetched correctly after a hard page reload
 *  7. Element with empty blobId triggers no blob fetch (shows unavailable, no crash)
 *
 * Run: npx playwright test --project=integration
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";

const NODE_URL = process.env.INTEGRATION_NODE_URL ?? "http://localhost:2430";
const TOKEN    = process.env.INTEGRATION_ACCESS_TOKEN ?? "";
const REFRESH  = process.env.INTEGRATION_REFRESH_TOKEN ?? "";
const APP_ID   = process.env.INTEGRATION_APP_ID ?? "";
const CTX_ID   = process.env.INTEGRATION_CONTEXT_ID ?? "";

test.skip(!TOKEN || !CTX_ID, "INTEGRATION_ACCESS_TOKEN and INTEGRATION_CONTEXT_ID must be set");

// Minimal valid 1×1 8-bit grayscale PNG (67 bytes, black pixel).
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55" +
  "0000000a49444154789c6260000000020001e221bc33" +
  "0000000049454e44ae426082",
  "hex",
);
const PNG_WIDTH = 1;
const PNG_HEIGHT = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function adminApi() {
  return playwrightRequest.newContext({
    baseURL: NODE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
  });
}

async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const api = await adminApi();
  const res = await api.post("/jsonrpc", {
    data: {
      jsonrpc: "2.0", id: 1, method: "execute",
      params: { contextId: CTX_ID, method, argsJson: args },
    },
  });
  const body = await res.json() as {
    error?: unknown;
    result?: { output?: number[] | string | object | null };
  };
  if (body.error) throw new Error(JSON.stringify(body.error));
  const out = body.result?.output;
  if (out == null) return null as T;
  if (Array.isArray(out)) {
    if (out.length === 0) return null as T;
    if (typeof out[0] !== "number") return out as T;
    const text = Buffer.from(out as number[]).toString("utf8");
    return JSON.parse(text) as T;
  }
  if (typeof out === "string") {
    try { return JSON.parse(out) as T; } catch { return out as T; }
  }
  return out as T;
}

async function uploadBlob(withContext = false): Promise<string> {
  const api = await adminApi();
  const url = withContext
    ? `/admin-api/blobs?context_id=${encodeURIComponent(CTX_ID)}`
    : "/admin-api/blobs";
  const res = await api.put(url, {
    data: PNG_1X1,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { data?: { blob_id?: string } };
  const blobId = body.data?.blob_id ?? "";
  expect(blobId.length).toBeGreaterThan(0);
  return blobId;
}

async function injectAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ nodeUrl, accessToken, refreshToken, applicationId }) => {
      localStorage.setItem("merodesign-auth", JSON.stringify({
        state: { nodeUrl, accessToken, refreshToken, applicationId },
        version: 0,
      }));
    },
    { nodeUrl: NODE_URL, accessToken: TOKEN, refreshToken: REFRESH, applicationId: APP_ID },
  );
}

async function gotoCanvas(page: import("@playwright/test").Page) {
  await injectAuth(page);
  await page.goto(`/teams/t/projects/${CTX_ID}`);
  await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 15_000 });
}

// ── 1. Blob upload API response format ───────────────────────────────────────

test.describe("Blob upload API", () => {
  test("response contains blob_id (snake_case, not blobId)", async () => {
    const api = await adminApi();
    const res = await api.put("/admin-api/blobs", {
      data: PNG_1X1,
      headers: { "Content-Type": "application/octet-stream" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // The real field name is blob_id. Our frontend fix reads this.
    const data = body.data as Record<string, unknown>;
    expect(typeof data?.blob_id).toBe("string");
    expect((data?.blob_id as string).length).toBeGreaterThan(0);

    // Confirm camelCase blobId does NOT exist — frontend must not rely on it
    expect(data?.blobId).toBeUndefined();
  });

  test("upload with context_id query param also returns blob_id", async () => {
    const blobId = await uploadBlob(true);
    expect(blobId.length).toBeGreaterThan(0);
  });

  test("uploaded blob can be downloaded back intact", async () => {
    const blobId = await uploadBlob();
    const api = await adminApi();
    const res = await api.get(`/admin-api/blobs/${blobId}`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.length).toBe(PNG_1X1.length);
    expect(buf.equals(PNG_1X1)).toBe(true);
  });
});

// ── 2. Image element + blob round-trip via WASM ───────────────────────────────

test.describe("Image element with blob", () => {
  let blobId = "";
  let elementId = "";

  test.beforeAll(async () => {
    // Upload blob with context_id so it's announced to the network
    blobId = await uploadBlob(true);

    elementId = `blob-test-${Date.now()}`;
    await rpc("add_element", {
      element: {
        id: elementId,
        data: { kind: "image", naturalWidth: PNG_WIDTH, naturalHeight: PNG_HEIGHT, blobId },
        x: 10, y: 10, width: PNG_WIDTH, height: PNG_HEIGHT,
        rotation: 0, fill: "transparent", stroke: "transparent",
        stroke_width: 0, opacity: 100, layer_index: 0,
        created_by: "blob-integration-test",
        created_at: Date.now(), updated_at: Date.now(),
        shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
        label: null,
      },
    });
  });

  test.afterAll(async () => {
    await rpc("delete_element", { id: elementId }).catch(() => {});
  });

  test("WASM stores blobId and dimensions correctly", async () => {
    const el = await rpc<{
      id: string;
      data: { kind: string; blobId?: string; naturalWidth?: number; naturalHeight?: number };
    }>("get_element", { id: elementId });

    expect(el).not.toBeNull();
    expect(el?.data.kind).toBe("image");
    expect(el?.data.blobId).toBe(blobId);
    expect(el?.data.naturalWidth).toBe(PNG_WIDTH);
    expect(el?.data.naturalHeight).toBe(PNG_HEIGHT);
  });

  test("blob is accessible from node after element is stored", async () => {
    const api = await adminApi();
    const res = await api.get(`/admin-api/blobs/${blobId}`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.length).toBe(PNG_1X1.length);
  });

  // ── 3. Browser: canvas fetches blob and renders (no error) ─────────────────

  test("canvas fetches blob after page load — no fetch error logged", async ({ page }) => {
    const blobStatuses: number[] = [];
    const blobErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.text().includes("blob fetch failed")) blobErrors.push(msg.text());
    });

    // Intercept the specific blob request so we can verify it was made and succeeded
    await page.route(`**${NODE_URL}/admin-api/blobs/${blobId}`, async (route) => {
      const response = await route.fetch();
      blobStatuses.push(response.status());
      return route.fulfill({ response });
    });

    // Also intercept via relative path (Vite proxy or direct)
    await page.route(`**/admin-api/blobs/${blobId}`, async (route) => {
      const response = await route.fetch();
      blobStatuses.push(response.status());
      return route.fulfill({ response });
    });

    await gotoCanvas(page);

    // Wait up to 10 s for the blob fetch triggered by the image element
    await page.waitForResponse(
      (r) => r.url().includes(`/admin-api/blobs/${blobId}`),
      { timeout: 10_000 },
    ).catch(() => { /* response may already have arrived */ });

    await page.waitForTimeout(2_000);

    expect(blobStatuses.length).toBeGreaterThan(0);
    expect(blobStatuses.every((s) => s === 200)).toBe(true);
    expect(blobErrors).toHaveLength(0);
  });

  test("blob loads again after hard page reload", async ({ page }) => {
    const blobStatuses: number[] = [];
    const blobErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.text().includes("blob fetch failed")) blobErrors.push(msg.text());
    });

    await page.route(`**/admin-api/blobs/${blobId}`, async (route) => {
      const response = await route.fetch();
      blobStatuses.push(response.status());
      return route.fulfill({ response });
    });

    await gotoCanvas(page);
    // Wait for first load
    await page.waitForResponse(
      (r) => r.url().includes(`/admin-api/blobs/${blobId}`),
      { timeout: 10_000 },
    ).catch(() => {});
    await page.waitForTimeout(1_000);

    const countBeforeReload = blobStatuses.length;
    expect(countBeforeReload).toBeGreaterThan(0);

    // Hard reload — the in-memory imageCache is cleared, blob must be fetched again
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 15_000 });
    await page.waitForResponse(
      (r) => r.url().includes(`/admin-api/blobs/${blobId}`),
      { timeout: 10_000 },
    ).catch(() => {});
    await page.waitForTimeout(2_000);

    // At least one more fetch after reload
    expect(blobStatuses.length).toBeGreaterThan(countBeforeReload);
    // All fetches succeeded — this is the main regression test
    expect(blobStatuses.every((s) => s === 200)).toBe(true);
    expect(blobErrors).toHaveLength(0);
  });
});

// ── 4. Element with empty blobId — no crash, no fetch ────────────────────────

test.describe("Image element with empty blobId", () => {
  let elementId = "";

  test.beforeAll(async () => {
    elementId = `no-blob-${Date.now()}`;
    await rpc("add_element", {
      element: {
        id: elementId,
        data: { kind: "image", naturalWidth: 50, naturalHeight: 50, blobId: "" },
        x: 200, y: 200, width: 50, height: 50,
        rotation: 0, fill: "transparent", stroke: "transparent",
        stroke_width: 0, opacity: 100, layer_index: 98,
        created_by: "blob-integration-test",
        created_at: Date.now(), updated_at: Date.now(),
        shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null,
        label: null,
      },
    });
  });

  test.afterAll(async () => {
    await rpc("delete_element", { id: elementId }).catch(() => {});
  });

  test("WASM stores element with empty blobId without error", async () => {
    const el = await rpc<{ data: { blobId?: string } }>("get_element", { id: elementId });
    expect(el).not.toBeNull();
    // blobId is either omitted (skip_serializing_if) or empty
    expect(el?.data.blobId ?? "").toBe("");
  });

  test("browser renders canvas without crashing for empty-blobId element", async ({ page }) => {
    const pageErrors: string[] = [];
    const unexpectedBlobFetches: string[] = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.text().includes("blob fetch failed")) unexpectedBlobFetches.push(msg.text());
    });

    await gotoCanvas(page);
    await page.waitForTimeout(4_000);

    // No JS crash
    expect(pageErrors).toHaveLength(0);
    // No failed blob fetch attempt (empty blobId should be skipped entirely)
    expect(unexpectedBlobFetches).toHaveLength(0);
    // Canvas is still visible
    await expect(page.getByTestId("fabric-canvas")).toBeVisible();
  });
});
