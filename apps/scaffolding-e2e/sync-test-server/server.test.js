// Tests for sync-test-server using Node.js built-in test runner (node:test).
// Run with: npm test  (requires Node 18+)

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createApp, computeStatus } = require("./server");

// ── Helper ────────────────────────────────────────────────────────────────────

let baseUrl;
let serverInstance;

function req(method, path, body) {
  const opts = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, opts).then((r) =>
    r.json().then((data) => ({ status: r.status, data })),
  );
}

const get = (path) => req("GET", path);
const post = (path, body) => req("POST", path, body);
const del = (path) => req("DELETE", path);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  () =>
    new Promise((resolve) => {
      const { server } = createApp();
      serverInstance = server;
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(() => new Promise((resolve) => serverInstance.close(resolve)));

beforeEach(async () => {
  await del("/runs");
});

// ── Unit: computeStatus ───────────────────────────────────────────────────────

describe("computeStatus", () => {
  test("no write no read → waiting", () => {
    const s = computeStatus({ write: null, read: null });
    assert.equal(s.phase, "waiting");
    assert.equal(s.synced, null);
  });

  test("write only → written", () => {
    const s = computeStatus({
      write: { key: "k", value: "v", nodeUrl: "a", timestamp: 1 },
      read: null,
    });
    assert.equal(s.phase, "written");
    assert.equal(s.synced, null);
  });

  test("read only → read_only", () => {
    const s = computeStatus({
      write: null,
      read: { key: "k", value: "v", nodeUrl: "b", timestamp: 2 },
    });
    assert.equal(s.phase, "read_only");
  });

  test("matching write+read → complete synced=true", () => {
    const s = computeStatus({
      write: { key: "k", value: "v", nodeUrl: "a", timestamp: 100 },
      read: { key: "k", value: "v", nodeUrl: "b", timestamp: 250 },
    });
    assert.equal(s.phase, "complete");
    assert.equal(s.synced, true);
    assert.equal(s.timingMs, 150);
    assert.equal(s.writtenBy, "a");
    assert.equal(s.readBy, "b");
  });

  test("mismatched values → complete synced=false", () => {
    const s = computeStatus({
      write: { key: "k", value: "v1", nodeUrl: "a", timestamp: 100 },
      read: { key: "k", value: "v2", nodeUrl: "b", timestamp: 200 },
    });
    assert.equal(s.phase, "complete");
    assert.equal(s.synced, false);
  });
});

// ── Integration: /health ──────────────────────────────────────────────────────

describe("GET /health", () => {
  test("returns ok=true and run count", async () => {
    const { status, data } = await get("/health");
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(typeof data.runs, "number");
  });
});

// ── Integration: /report ──────────────────────────────────────────────────────

describe("POST /report", () => {
  test("write action → phase=written", async () => {
    const { status, data } = await post("/report", {
      runId: "r1",
      action: "write",
      key: "mykey",
      value: "myval",
      nodeUrl: "http://localhost:2528",
    });
    assert.equal(status, 200);
    assert.equal(data.runId, "r1");
    assert.equal(data.recorded, "write");
    assert.equal(data.phase, "written");
  });

  test("write then read with matching value → phase=complete synced=true", async () => {
    const run = "r2";
    await post("/report", { runId: run, action: "write", key: "k", value: "hello", nodeUrl: "a" });
    const { status, data } = await post("/report", {
      runId: run,
      action: "read",
      key: "k",
      value: "hello",
      nodeUrl: "b",
    });
    assert.equal(status, 200);
    assert.equal(data.phase, "complete");
    assert.equal(data.synced, true);
    assert.equal(typeof data.timingMs, "number");
  });

  test("write then read with wrong value → synced=false", async () => {
    const run = "r3";
    await post("/report", { runId: run, action: "write", key: "k", value: "hello", nodeUrl: "a" });
    const { data } = await post("/report", {
      runId: run,
      action: "read",
      key: "k",
      value: "wrong",
      nodeUrl: "b",
    });
    assert.equal(data.synced, false);
  });

  test("missing fields → 400", async () => {
    const { status } = await post("/report", { runId: "x", action: "write" });
    assert.equal(status, 400);
  });

  test("invalid action → 400", async () => {
    const { status } = await post("/report", {
      runId: "x",
      action: "delete",
      key: "k",
      nodeUrl: "a",
    });
    assert.equal(status, 400);
  });
});

// ── Integration: /status ──────────────────────────────────────────────────────

describe("GET /status", () => {
  test("empty → empty array", async () => {
    const { data } = await get("/status");
    assert.deepEqual(data, []);
  });

  test("includes write field after a write report", async () => {
    await post("/report", { runId: "s1", action: "write", key: "k", value: "v", nodeUrl: "a" });
    const { data } = await get("/status");
    assert.equal(data.length, 1);
    assert.equal(data[0].runId, "s1");
    assert.equal(data[0].phase, "written");
    assert.ok(data[0].write, "write field should be present");
    assert.equal(data[0].write.key, "k");
  });
});

describe("GET /status/:runId", () => {
  test("unknown runId → 404", async () => {
    const { status } = await get("/status/doesnotexist");
    assert.equal(status, 404);
  });

  test("known runId → correct phase", async () => {
    await post("/report", { runId: "s2", action: "write", key: "k", value: "v", nodeUrl: "a" });
    const { status, data } = await get("/status/s2");
    assert.equal(status, 200);
    assert.equal(data.runId, "s2");
    assert.equal(data.phase, "written");
  });
});

// ── Integration: /runs ────────────────────────────────────────────────────────

describe("DELETE /runs", () => {
  test("clears all runs", async () => {
    await post("/report", { runId: "d1", action: "write", key: "k", value: "v", nodeUrl: "a" });
    await del("/runs");
    const { data } = await get("/status");
    assert.deepEqual(data, []);
  });
});

describe("DELETE /runs/:runId", () => {
  test("removes specific run", async () => {
    await post("/report", { runId: "d2", action: "write", key: "k", value: "v", nodeUrl: "a" });
    await post("/report", { runId: "d3", action: "write", key: "k", value: "v", nodeUrl: "a" });
    await del("/runs/d2");
    const { data } = await get("/status");
    assert.equal(data.length, 1);
    assert.equal(data[0].runId, "d3");
  });
});
