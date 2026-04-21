#!/usr/bin/env node
// Sync Test Server — coordinates cross-node CRDT sync verification.
// Both Node A and Node B frontends POST their write/read events here.
// The server compares them and exposes a /status endpoint showing whether sync occurred.

const http = require("http");

const DEFAULT_PORT = process.env.PORT || 3099;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

function makeRun() {
  return { write: null, read: null, createdAt: Date.now() };
}

function parsedBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function jsonReply(res, status, data, corsOrigin) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function computeStatus(run) {
  const { write, read } = run;
  if (!write && !read) return { phase: "waiting", synced: null };
  if (write && !read) return { phase: "written", synced: null };
  if (!write && read) return { phase: "read_only", synced: null };
  const synced = write.key === read.key && write.value === read.value;
  const timingMs = read.timestamp - write.timestamp;
  return { phase: "complete", synced, timingMs, writtenBy: write.nodeUrl, readBy: read.nodeUrl };
}

function log(method, path, status, extra) {
  const ts = new Date().toLocaleTimeString();
  const line = extra
    ? `[${ts}] ${method} ${path} → ${status}  ${extra}`
    : `[${ts}] ${method} ${path} → ${status}`;
  console.log(line);
}

function createApp() {
  const runs = new Map();

  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => jsonReply(res, status, data, CORS_ORIGIN);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost`);
    const path = url.pathname;

    // GET /health
    if (req.method === "GET" && path === "/health") {
      log("GET", path, 200, `runs=${runs.size}`);
      return reply(200, { ok: true, runs: runs.size });
    }

    // GET /status  or  GET /status/:runId
    if (req.method === "GET" && path.startsWith("/status")) {
      const runId = path.slice("/status".length).replace(/^\//, "") || null;
      if (runId) {
        const run = runs.get(runId);
        if (!run) {
          log("GET", path, 404, `runId=${runId} not found`);
          return reply(404, { error: "run not found" });
        }
        const status = computeStatus(run);
        log("GET", path, 200, `runId=${runId} phase=${status.phase}`);
        return reply(200, { runId, ...run, ...status });
      }
      const all = [];
      for (const [id, run] of runs) {
        all.push({
          runId: id,
          ...computeStatus(run),
          write: run.write,
          read: run.read,
          createdAt: run.createdAt,
        });
      }
      log("GET", path, 200, `${all.length} run(s)`);
      return reply(200, all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20));
    }

    // POST /report
    if (req.method === "POST" && path === "/report") {
      let body;
      try {
        body = await parsedBody(req);
      } catch (e) {
        return reply(400, { error: e.message });
      }

      const { runId, action, key, value, nodeUrl } = body;
      if (!runId || !action || !key || nodeUrl === undefined) {
        log("POST", path, 400, "missing fields");
        return reply(400, { error: "missing required fields: runId, action, key, nodeUrl" });
      }
      if (action !== "write" && action !== "read") {
        log("POST", path, 400, `invalid action=${action}`);
        return reply(400, { error: "action must be 'write' or 'read'" });
      }

      if (!runs.has(runId)) runs.set(runId, makeRun());
      const run = runs.get(runId);
      run[action] = { key, value: value ?? null, nodeUrl, timestamp: Date.now() };

      const status = computeStatus(run);
      log(
        "POST",
        path,
        200,
        `runId=${runId} action=${action} key=${key} node=${nodeUrl} → phase=${status.phase}${status.synced != null ? ` synced=${status.synced}` : ""}`,
      );
      return reply(200, { runId, recorded: action, ...status });
    }

    // DELETE /runs
    if (req.method === "DELETE" && path === "/runs") {
      const count = runs.size;
      runs.clear();
      log("DELETE", path, 200, `cleared ${count} run(s)`);
      return reply(200, { cleared: true });
    }

    // DELETE /runs/:runId
    if (req.method === "DELETE" && path.startsWith("/runs/")) {
      const runId = path.slice("/runs/".length);
      const existed = runs.delete(runId);
      log("DELETE", path, 200, `runId=${runId} existed=${existed}`);
      return reply(200, { runId, deleted: existed });
    }

    log(req.method, path, 404);
    reply(404, { error: "not found" });
  });

  return { server, runs };
}

module.exports = { createApp, computeStatus };

if (require.main === module) {
  const { server } = createApp();
  server.listen(DEFAULT_PORT, () => {
    console.log(`Calimero Sync Test Server running on http://localhost:${DEFAULT_PORT}`);
    console.log(`  GET  /health          — server health check`);
    console.log(`  GET  /status          — list recent runs`);
    console.log(`  GET  /status/:runId   — get run result`);
    console.log(`  POST /report          — report a write or read event`);
    console.log(`  DELETE /runs          — reset all runs`);
    console.log(`  DELETE /runs/:runId   — delete a run`);
  });
}
