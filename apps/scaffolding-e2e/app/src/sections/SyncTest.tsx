import { useState, useCallback, useRef, useEffect } from "react";
import { getAppEndpointKey } from "@calimero-network/calimero-client";
import * as api from "../api/kvStore";

// Both frontends (Node A and Node B) connect to the same sync server.
// Node A writes a key, posts a test to the server.
// Node B has a watcher running — it polls the server, auto-reads the key from
// its own Calimero node, and reports back. No manual step on Node B.

const DEFAULT_SERVER = "http://localhost:3099";
const POLL_MS = 1500;
const MAX_RETRIES = 20; // 30s total at 1.5s each

const C = {
  border: "var(--color-border)",
  text: "var(--color-text-primary)",
  muted: "var(--color-text-muted)",
  brand: "var(--color-brand-600)",
  success: "var(--color-success)",
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  surface: "var(--color-bg-input)",
  card: "var(--color-bg-card)",
};

interface RunStatus {
  runId: string;
  phase: "waiting" | "written" | "read_only" | "complete";
  synced: boolean | null;
  timingMs?: number;
  writtenBy?: string;
  readBy?: string;
  write?: { key: string; value: string; nodeUrl: string; timestamp: number } | null;
  read?: { key: string; value: string | null; nodeUrl: string; timestamp: number } | null;
}

async function serverFetch(serverUrl: string, path: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(`${serverUrl}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

export function SyncTest() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const nodeUrl = getAppEndpointKey() ?? "unknown";
  const nodeLabel = nodeUrl.replace(/^https?:\/\//, "");

  // ── Writer state ───────────────────────────────────────────────────────────
  const [key, setKey] = useState("sync_test_key");
  const [value, setValue] = useState("hello_from_node_a");
  const [writing, setWriting] = useState(false);
  const [writeResult, setWriteResult] = useState<RunStatus | null>(null);
  const [writeLog, setWriteLog] = useState<string[]>([]);
  const writeRunIdRef = useRef<string | null>(null);
  const pollActiveRef = useRef(false);

  // ── Watcher state (Node B) ─────────────────────────────────────────────────
  const [watching, setWatching] = useState(false);
  const [watchLog, setWatchLog] = useState<string[]>([]);
  const [watchResult, setWatchResult] = useState<RunStatus | null>(null);
  const watchRef = useRef(false);
  const seenRunIds = useRef<Set<string>>(new Set());

  function addWriteLog(msg: string) {
    setWriteLog((p) => [...p.slice(-14), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }
  function addWatchLog(msg: string) {
    setWatchLog((p) => [...p.slice(-14), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  async function checkServer() {
    try {
      const r = await serverFetch(serverUrl, "/health") as { ok?: boolean };
      setServerOk(r?.ok === true);
    } catch {
      setServerOk(false);
    }
  }

  // ── Writer (Node A) ────────────────────────────────────────────────────────
  const runWrite = useCallback(async () => {
    if (writing) return;
    setWriting(true);
    setWriteResult(null);
    const runId = `sync_${Date.now().toString(36)}`;
    addWriteLog(`Writing key="${key}" value="${value}"…`);
    try {
      const res = await api.kvSet(key, value) as { error?: unknown };
      if (res?.error) throw new Error(JSON.stringify(res.error));
      addWriteLog(`KV write OK. Posting to sync server (runId: ${runId})…`);

      const report = await serverFetch(serverUrl, "/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId, action: "write", key, value,
          nodeUrl: getAppEndpointKey() ?? "unknown",
        }),
      }) as RunStatus;

      setWriteResult(report);
      writeRunIdRef.current = runId;
      addWriteLog(`Posted. Polling for watcher result…`);
    } catch (e) {
      addWriteLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }

    // Poll for completion in background — independent of writing state
    const activeRunId = writeRunIdRef.current;
    if (!activeRunId) return;
    pollActiveRef.current = true;
    for (let i = 0; i < 60 && pollActiveRef.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const status = await serverFetch(serverUrl, `/status/${activeRunId}`) as RunStatus;
        setWriteResult(status);
        if (status.phase === "complete") {
          addWriteLog(status.synced
            ? `✓ Sync confirmed in ${status.timingMs}ms (read by ${status.readBy})`
            : `✗ Sync failed — watcher got "${status.read?.value ?? "null"}"`
          );
          pollActiveRef.current = false;
          break;
        }
      } catch { /* server unreachable, keep polling */ }
    }
    if (pollActiveRef.current) {
      addWriteLog("No response from watcher after 90s — is Node B watching?");
      pollActiveRef.current = false;
    }
  }, [writing, key, value, serverUrl]);

  // ── Watcher (Node B) ───────────────────────────────────────────────────────
  const startWatching = useCallback(async () => {
    watchRef.current = true;
    setWatching(true);
    setWatchResult(null);
    addWatchLog(`Watching ${serverUrl} for new sync tests…`);

    while (watchRef.current) {
      try {
        const runs = await serverFetch(serverUrl, "/status") as RunStatus[];
        // Find a written run we haven't processed yet
        const pending = Array.isArray(runs)
          ? runs.find((r) => r.phase === "written" && !seenRunIds.current.has(r.runId))
          : null;

        if (pending) {
          seenRunIds.current.add(pending.runId);
          const testKey = pending.write?.key;
          if (!testKey) continue;

          addWatchLog(`Detected new test (runId: ${pending.runId}). Reading key="${testKey}"…`);

          // Poll Calimero until the key appears or we time out
          let readValue: string | null = null;
          let attempt = 0;
          while (attempt < MAX_RETRIES) {
            const kvRes = await api.kvGet(testKey) as { result?: { output?: string | null }; error?: unknown };
            if (!kvRes?.error) {
              readValue = kvRes?.result?.output ?? null;
              if (readValue !== null) break;
            }
            attempt++;
            addWatchLog(`Attempt ${attempt}/${MAX_RETRIES}: key not yet synced, retrying…`);
            await new Promise((r) => setTimeout(r, POLL_MS));
          }

          addWatchLog(readValue !== null
            ? `Key found after ${attempt} retries — value="${readValue}". Reporting…`
            : `Key not found after ${MAX_RETRIES} retries. Reporting null.`
          );

          const report = await serverFetch(serverUrl, "/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId: pending.runId, action: "read",
              key: testKey, value: readValue,
              nodeUrl: getAppEndpointKey() ?? "unknown",
            }),
          }) as RunStatus;

          setWatchResult(report);
          addWatchLog(report.synced
            ? `Sync VERIFIED in ${report.timingMs}ms`
            : `Sync FAILED — expected "${pending.write?.value}", got "${readValue}"`
          );
        }
      } catch {
        // Server unreachable — keep trying
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    addWatchLog("Watcher stopped.");
    setWatching(false);
  }, [serverUrl]);

  function stopWatching() {
    watchRef.current = false;
  }

  useEffect(() => {
    return () => {
      watchRef.current = false;
      pollActiveRef.current = false;
    };
  }, []);

  const writePhaseColor = writeResult
    ? writeResult.phase === "complete"
      ? writeResult.synced ? C.success : C.error
      : C.warning
    : C.border;

  const watchPhaseColor = watchResult
    ? watchResult.synced ? C.success : C.error
    : C.border;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Sync Test</h2>
        <p className="section-desc">
          Verify that CRDT state propagates between two nodes.
          Both panels live on the same page — <strong style={{ color: "var(--color-text-primary)" }}>use the Writer on one node's tab and the Watcher on the other.</strong>{" "}
          Open this page in a second browser (or incognito) pointed at your other node, start the Watcher there, then come back here and write.
        </p>
      </div>

      {/* How it works */}
      <div className="method-card" style={{ marginBottom: 16, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.25)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.brand, marginBottom: 8 }}>How it works</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
          <li>Start the sync server: <code style={{ background: C.surface, padding: "1px 5px", borderRadius: 3 }}>cd sync-test-server && node server.js</code></li>
          <li>Open this page in a <strong>second browser / incognito</strong> pointed at Node B (<code>?node=http://localhost:2529</code>) and click <strong>Start Watching</strong>.</li>
          <li>Back on Node A's tab, click <strong>Write & Post Test</strong>.</li>
          <li>Node B's watcher detects the run, reads the key from <em>its own</em> Calimero node (retrying until synced), and reports back. The Writer panel updates when sync is confirmed.</li>
        </ol>
        <div style={{ marginTop: 10, fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          Each tab uses its <strong>own JWT and node URL</strong> — the watcher reads from whichever node the tab is connected to. No cross-node auth needed.
        </div>
      </div>

      {/* Server */}
      <div className="method-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.brand, marginBottom: 8 }}>Sync Server</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="form-control"
            style={{ flex: 1, fontSize: 12 }}
            value={serverUrl}
            onChange={(e) => { setServerUrl(e.target.value); setServerOk(null); }}
            placeholder="http://localhost:3099"
          />
          <button className="btn-calimero-outline" style={{ fontSize: 12 }} onClick={checkServer}>
            Ping
          </button>
          {serverOk === true && <span style={{ color: C.success, fontSize: 12, flexShrink: 0 }}>● Online</span>}
          {serverOk === false && <span style={{ color: C.error, fontSize: 12, flexShrink: 0 }}>● Offline</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Writer */}
        <div className="method-card" style={{ borderColor: writeResult ? writePhaseColor : C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.brand, marginBottom: 2 }}>
            ✏ Writer
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>
            this node: <code style={{ fontSize: 10 }}>{nodeLabel}</code>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Key</div>
            <input className="form-control" style={{ width: "100%", fontSize: 12, boxSizing: "border-box" as const }} value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Value</div>
            <input className="form-control" style={{ width: "100%", fontSize: 12, boxSizing: "border-box" as const }} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <button className="btn-calimero" onClick={runWrite} disabled={writing || !key || !value} style={{ width: "100%" }}>
            {writing ? "Writing…" : "Write & Post Test"}
          </button>

          {writeResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {writeResult.phase === "written" && (
                <span style={{ color: C.warning, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="spinner" style={{ borderColor: C.warning, borderTopColor: "transparent" }} />
                  Waiting for watcher on Node B…
                </span>
              )}
              {writeResult.phase === "complete" && (
                <span style={{ color: writeResult.synced ? C.success : C.error, fontWeight: 600 }}>
                  {writeResult.synced ? `✓ Synced in ${writeResult.timingMs}ms` : "✗ Sync failed"}
                </span>
              )}
            </div>
          )}

          {writeLog.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 10, color: C.muted, lineHeight: 1.7, maxHeight: 100, overflowY: "auto" as const }}>
              {writeLog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        {/* Watcher */}
        <div className="method-card" style={{ borderColor: watchResult ? watchPhaseColor : watching ? C.brand : C.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.brand, marginBottom: 2 }}>
            📡 Watcher
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>
            this node: <code style={{ fontSize: 10 }}>{nodeLabel}</code>
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px", lineHeight: 1.6 }}>
            Polls the sync server for tests posted by the Writer. When one appears, reads the key
            from <strong style={{ color: C.text }}>this node's</strong> Calimero instance and reports the result.
          </p>

          {!watching ? (
            <button className="btn-calimero" onClick={startWatching} style={{ width: "100%" }}>
              Start Watching
            </button>
          ) : (
            <button className="btn-calimero-outline" onClick={stopWatching} style={{ width: "100%" }}>
              Stop Watching
            </button>
          )}

          {watching && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.warning, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
              Watching for tests…
            </div>
          )}

          {watchResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <span style={{ color: watchResult.synced ? C.success : C.error, fontWeight: 700 }}>
                {watchResult.synced ? `Sync verified in ${watchResult.timingMs}ms ✓` : "Sync failed ✗"}
              </span>
              {watchResult.read && (
                <div style={{ marginTop: 4, color: C.muted }}>
                  Read: <code style={{ color: watchResult.synced ? C.success : C.error }}>
                    {watchResult.read.key} = {watchResult.read.value ?? "null"}
                  </code>
                </div>
              )}
            </div>
          )}

          {watchLog.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 10, color: C.muted, lineHeight: 1.7, maxHeight: 100, overflowY: "auto" as const }}>
              {watchLog.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
