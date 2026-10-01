/**
 * Blobs across two real nodes.
 *
 * This is the suite that exists because nothing else in the ecosystem tests it.
 * Every other blob test — here and in the apps monorepo — uploads and downloads
 * against ONE node, which passes whether or not discovery works: the node
 * already holds the bytes and answers from its own store without ever probing a
 * peer. The interesting path is the other one, and it is the one users hit
 * every time somebody sends a picture.
 *
 * So these tests upload on node 1 and read from node 2.
 *
 * ── What changed, and why a one-node test can't see it ───────────────────────
 *
 * Before core 0.11.0-rc.39 a node that wanted a blob asked a DHT. rc.39 removed
 * it. A read is now either LOCAL (no `context_id`: look in my own store, else
 * 404) or DISCOVERY (`context_id` given: probe that context's peers for a
 * holder, then transfer). `?context_id=` stopped being a hint and became the
 * only way a blob is found at all.
 *
 * The READ side is the load-bearing one, and that is a measurement, not a
 * reading of the docs: a read with no context never leaves the local store,
 * while an upload with no context is still served to a peer that asks with one
 * (see the last test in "cross-node transfer", which asserted the documented
 * behaviour first and was corrected by the node). The uploader's announce feeds
 * availability-node prefetch instead.
 *
 * Either way the sender sees their own image perfectly well, because their own
 * node has it. Only the recipient sees nothing, and there is no error anywhere
 * to explain it — which is why these run against two nodes.
 *
 * ── Budgets ──────────────────────────────────────────────────────────────────
 *
 * Core bounds the discovery sweep at ~30s and the byte transfer comes after, so
 * every cross-node read here is given well over a minute. A test that allows
 * less measures its own impatience.
 *
 * Prerequisites: ./scripts/setup-nodes.sh (or the Integration CI job), which
 * starts two nodes joined to one context and writes app/.env.integration.
 * Without it every test skips.
 *
 * Run:  pnpm exec playwright test --project=integration
 */
import { test, expect } from "@playwright/test";
import {
  getIntegrationEnv,
  integrationEnvAvailable,
} from "./helpers/node-client";

/**
 * A blob read that has to find a peer is bounded by core at ~30s BEFORE the
 * transfer starts. 90s leaves room for the sweep plus the bytes without being
 * so long that a genuine hang looks like a slow pass.
 */
const CROSS_NODE_TIMEOUT_MS = 90_000;

/** Distinctive bytes: a wrong-length or zero-filled answer is obvious. */
function payload(label: string): Buffer {
  const head = Buffer.from(`curb-blob-test:${label}:`, "utf8");
  const body = Buffer.alloc(4096);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 0xff;
  return Buffer.concat([head, body]);
}

function auth(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `PUT /admin-api/blobs`, the raw wire call.
 *
 * Deliberately not through mero-js: this asserts what the NODE does, so going
 * through the SDK would leave it able to pass on a node that had changed, as
 * long as the SDK had changed with it. The app-side shape is covered by
 * src/api/blobs.test.ts.
 *
 * The body is the bytes, streamed as octet-stream. Never FormData — this route
 * does not parse multipart, so the boundary and part headers would be stored as
 * part of the blob. It round-trips, and every byte comes back wrong.
 */
async function putBlob(
  nodeUrl: string,
  token: string,
  data: Buffer,
  contextId?: string,
): Promise<{ status: number; blobId: string }> {
  const url = contextId
    ? `${nodeUrl}/admin-api/blobs?context_id=${encodeURIComponent(contextId)}`
    : `${nodeUrl}/admin-api/blobs`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...auth(token), "Content-Type": "application/octet-stream" },
    body: new Uint8Array(data),
  });
  if (!res.ok) return { status: res.status, blobId: "" };
  // The wire is `{ data: { blob_id, size } }` — snake_case, nested. mero-js
  // renames and unwraps it; at this level it does not.
  const body = (await res.json()) as {
    data?: { blob_id?: string; blobId?: string };
  };
  return {
    status: res.status,
    blobId: body.data?.blob_id ?? body.data?.blobId ?? "",
  };
}

async function getBlob(
  nodeUrl: string,
  token: string,
  blobId: string,
  contextId?: string,
  signal?: AbortSignal,
): Promise<{ status: number; bytes: Buffer | null }> {
  const url = contextId
    ? `${nodeUrl}/admin-api/blobs/${blobId}?context_id=${encodeURIComponent(contextId)}`
    : `${nodeUrl}/admin-api/blobs/${blobId}`;
  const res = await fetch(url, { headers: auth(token), signal });
  if (!res.ok) return { status: res.status, bytes: null };
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

test.beforeAll(() => {
  if (!integrationEnvAvailable()) {
    console.log(
      "[blobs] E2E_NODE_URL / E2E_ACCESS_TOKEN / E2E_CONTEXT_ID not set — skipping.\n" +
        "[blobs] Run  ./scripts/setup-nodes.sh  to start live nodes.",
    );
  }
});

function requireEnv() {
  if (!integrationEnvAvailable()) test.skip();
  return getIntegrationEnv();
}

/** Both nodes, plus the context they share. Skips when only one is configured. */
function requireTwoNodes() {
  const env = requireEnv();
  if (!env.nodeUrl2) {
    test.skip(
      true,
      "E2E_NODE_URL_2 not set — cross-node blob tests need two nodes",
    );
  }
  return env;
}

// ── The shape of a blob id ────────────────────────────────────────────────────

test.describe("blob ids", () => {
  test("the node answers with 64 hex characters, not base58", async () => {
    const env = requireEnv();
    const { status, blobId } = await putBlob(
      env.nodeUrl,
      env.accessToken,
      payload("id-shape"),
      env.contextId,
    );
    expect(status).toBe(200);

    // Since core 0.11.0-rc.27 an id is 32 bytes as hex. This asserts it
    // positively rather than just "non-empty", because the failure it guards
    // against is an app re-encoding to base58: base58 of 32 bytes is ~44
    // characters from a wider alphabet, so it passes a length>0 check and is
    // then refused by the node on the way back in.
    expect(blobId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a base58 spelling of a real id is refused on read", async () => {
    const env = requireEnv();
    const { blobId } = await putBlob(
      env.nodeUrl,
      env.accessToken,
      payload("base58-refused"),
      env.contextId,
    );
    expect(blobId).toMatch(/^[0-9a-f]{64}$/);

    // Same 32 bytes, wrong encoding. This is exactly what the app used to store
    // and is why `toBlobIdHex` exists. The node must not accept it — if it ever
    // did, the defect would be invisible again.
    const bs58 = (await import("bs58")).default;
    const wrong = bs58.encode(Buffer.from(blobId, "hex"));
    expect(wrong).not.toBe(blobId);

    const res = await getBlob(
      env.nodeUrl,
      env.accessToken,
      wrong,
      env.contextId,
    );
    expect(res.bytes).toBeNull();
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Bytes crossing a node ─────────────────────────────────────────────────────

test.describe("cross-node transfer", () => {
  test.describe.configure({ timeout: CROSS_NODE_TIMEOUT_MS });

  test("bytes uploaded on node 1 arrive intact on node 2", async () => {
    const env = requireTwoNodes();
    const data = payload("cross-node");

    // Announced to the shared context. Node 2 is a member of it (the merobox
    // setup joins it), so it has somebody to probe.
    const up = await putBlob(env.nodeUrl, env.accessToken, data, env.contextId);
    expect(up.status).toBe(200);
    expect(up.blobId).toMatch(/^[0-9a-f]{64}$/);

    // THE assertion. Node 2 has never seen these bytes: it must discover a
    // holder through the context and pull them. Everything else in this file
    // is scaffolding around this one call.
    const down = await getBlob(
      env.nodeUrl2,
      env.accessToken2 || env.accessToken,
      up.blobId,
      env.contextId,
      AbortSignal.timeout(CROSS_NODE_TIMEOUT_MS - 10_000),
    );

    expect(down.status).toBe(200);
    expect(down.bytes).not.toBeNull();
    // Byte-for-byte, not just length: a multipart-wrapped upload round-trips at
    // the wrong length, and a truncated transfer round-trips at the right one.
    expect(down.bytes!.equals(data)).toBe(true);
  });

  test("a HEAD probe finds it on node 2 without transferring it", async () => {
    const env = requireTwoNodes();
    const data = payload("head-probe");
    const up = await putBlob(env.nodeUrl, env.accessToken, data, env.contextId);
    expect(up.status).toBe(200);

    const res = await fetch(
      `${env.nodeUrl2}/admin-api/blobs/${up.blobId}?context_id=${encodeURIComponent(env.contextId)}`,
      {
        method: "HEAD",
        headers: auth(env.accessToken2 || env.accessToken),
        signal: AbortSignal.timeout(CROSS_NODE_TIMEOUT_MS - 10_000),
      },
    );

    expect(res.status).toBe(200);
    // Presence and size come back in headers; the body does not. `x-blob-source`
    // says where the answer came from — a peer probe carries no hash or mime
    // type, which is correct, not malformed.
    expect(Number(res.headers.get("content-length"))).toBe(data.length);
  });

  test("the same blob read WITHOUT a context is not found on node 2", async () => {
    const env = requireTwoNodes();
    const data = payload("no-context-read");

    const up = await putBlob(env.nodeUrl, env.accessToken, data, env.contextId);
    expect(up.status).toBe(200);

    // No `context_id` → local-only lookup. Node 2 does not hold these bytes, so
    // this must miss. It is the control for the test above: without it, a node
    // that happened to have prefetched the blob would make discovery look like
    // it worked when it had not run at all.
    const down = await getBlob(
      env.nodeUrl2,
      env.accessToken2 || env.accessToken,
      up.blobId,
    );
    expect(down.status).toBe(404);
    expect(down.bytes).toBeNull();
  });

  // ── MEASURED, and not what the upload-side docs imply ──────────────────────
  //
  // This test asserted the opposite first — that a blob uploaded without
  // `?context_id=` "never reaches node 2" — because that is what the SDK's own
  // doc says ("Without it the blob is only readable on this node"). Against
  // real rc.41 nodes, node 2 answered **200**.
  //
  // So discovery is driven by the READER's context, not the writer's announce.
  // Node 2 probes that context's peers; node 1 is a member and holds the bytes,
  // so it serves them — whether or not the upload named a context. The
  // announce feeds availability-node prefetch (`blob_announce_to_context`
  // returns once the announce is SCHEDULED, and since rc.39 that path is
  // prefetch only, never discovery), which matters when the holder is offline
  // and an availability node has to answer instead.
  //
  // The app still requires a context on upload — it costs nothing, it is the
  // documented contract, and prefetch is worth having — but the honest reason
  // is "so a peer that is offline can still be served", NOT "otherwise nobody
  // can read it". Asserting the measured behaviour, so that if core ever does
  // tighten this, the change is caught here rather than discovered in an app.
  test("a blob uploaded with NO context is still served to node 2, via the reader's context", async () => {
    const env = requireTwoNodes();
    const data = payload("no-context-upload");

    const up = await putBlob(env.nodeUrl, env.accessToken, data);
    expect(up.status).toBe(200);
    expect(up.blobId).toMatch(/^[0-9a-f]{64}$/);

    // Readable where it was stored, obviously.
    const local = await getBlob(
      env.nodeUrl,
      env.accessToken,
      up.blobId,
      env.contextId,
    );
    expect(local.status).toBe(200);
    expect(local.bytes!.equals(data)).toBe(true);

    // And readable from node 2 too, because node 2 supplies a context whose
    // peers include the holder. Byte-for-byte, so this is a real transfer and
    // not a 200 with an empty body.
    const remote = await getBlob(
      env.nodeUrl2,
      env.accessToken2 || env.accessToken,
      up.blobId,
      env.contextId,
      AbortSignal.timeout(CROSS_NODE_TIMEOUT_MS - 10_000),
    );
    expect(remote.status).toBe(200);
    expect(remote.bytes!.equals(data)).toBe(true);
  });
});

// ── Round trip on one node ────────────────────────────────────────────────────

test.describe("same-node round trip", () => {
  test("bytes come back byte-for-byte", async () => {
    const env = requireEnv();
    const data = payload("round-trip");

    const up = await putBlob(env.nodeUrl, env.accessToken, data, env.contextId);
    expect(up.status).toBe(200);

    const down = await getBlob(
      env.nodeUrl,
      env.accessToken,
      up.blobId,
      env.contextId,
    );
    expect(down.status).toBe(200);
    expect(down.bytes!.equals(data)).toBe(true);
  });

  test("identical bytes are one blob; different bytes are not", async () => {
    const env = requireEnv();
    const a = payload("dedupe");
    const b = payload("dedupe-other");

    const first = await putBlob(env.nodeUrl, env.accessToken, a, env.contextId);
    const same = await putBlob(env.nodeUrl, env.accessToken, a, env.contextId);
    const other = await putBlob(env.nodeUrl, env.accessToken, b, env.contextId);

    // The id is content-addressed, so re-uploading the same file must not
    // produce a second blob — and two different files must never collide.
    expect(same.blobId).toBe(first.blobId);
    expect(other.blobId).not.toBe(first.blobId);
  });

  test("an unknown blob id is a 404, not an error page", async () => {
    const env = requireEnv();
    const missing = "f".repeat(64);
    const res = await getBlob(
      env.nodeUrl,
      env.accessToken,
      missing,
      env.contextId,
    );
    expect(res.status).toBe(404);
  });
});
