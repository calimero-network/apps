import { useState, useCallback } from "react";
import { ResultBox } from "../components/ResultBox";
import * as api from "../api/kvStore";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { SyncBar } from "../components/SyncBar";


function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);

  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return { loading, result, run };
}

export function KvOperations() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [getKey, setGetKey] = useState("");
  const [removeKey, setRemoveKey] = useState("");
  const [liveEntries, setLiveEntries] = useState<Record<string, string> | null>(null);

  const setCall = useCall();
  const getCall = useCall();
  const getResultCall = useCall();
  const lenCall = useCall();
  const removeCall = useCall();
  const clearCall = useCall();

  const poll = useCallback(async () => {
    const res = await api.kvEntries();
    const out = (res as { result?: { output?: Record<string, string> } })?.result?.output;
    if (out !== undefined) setLiveEntries(out);
  }, []);

  const { pulse, sinceLabel } = useAutoRefresh(poll, 3000);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">KV Operations</h2>
        <p className="section-desc">
          Basic key-value store: set, get, list, remove, clear. Entries auto-refresh every 3 s —
          write a key on Node A and watch it appear here on Node B.
        </p>
      </div>

      {/* Live entries panel */}
      <div className="method-card" style={{ marginBottom: 16 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        <div className="method-name">entries() — live view</div>
        {liveEntries === null ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>Loading…</p>
        ) : Object.keys(liveEntries).length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>Store is empty.</p>
        ) : (
          <pre className="result-box" style={{ margin: 0 }}>
            {JSON.stringify(liveEntries, null, 2)}
          </pre>
        )}
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">set(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setCall.loading}
            onClick={() => setCall.run(async () => { const r = await api.kvSet(key, value); poll(); return r; })}
          >
            {setCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get(key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={getKey}
              onChange={(e) => setGetKey(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero-outline"
              disabled={getCall.loading}
              onClick={() => getCall.run(() => api.kvGet(getKey))}
            >
              {getCall.loading ? "..." : "get"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getResultCall.loading}
              onClick={() => getResultCall.run(() => api.kvGetResult(getKey))}
            >
              {getResultCall.loading ? "..." : "get_result"}
            </button>
          </div>
          <ResultBox result={getCall.result} />
          <ResultBox result={getResultCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">len()</div>
          <button
            className="btn-calimero-outline"
            disabled={lenCall.loading}
            onClick={() => lenCall.run(() => api.kvLen())}
          >
            {lenCall.loading ? "..." : "len"}
          </button>
          <ResultBox result={lenCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">remove(key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={removeKey}
              onChange={(e) => setRemoveKey(e.target.value)}
            />
          </div>
          <button
            className="btn-danger-outline"
            disabled={removeCall.loading}
            onClick={() => removeCall.run(async () => { const r = await api.kvRemove(removeKey); poll(); return r; })}
          >
            {removeCall.loading ? "..." : "remove"}
          </button>
          <ResultBox result={removeCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">clear()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Removes all entries from the store.
          </p>
          <button
            className="btn-danger-outline"
            disabled={clearCall.loading}
            onClick={() => clearCall.run(async () => { const r = await api.kvClear(); poll(); return r; })}
          >
            {clearCall.loading ? "..." : "clear"}
          </button>
          <ResultBox result={clearCall.result} />
        </div>
      </div>
    </div>
  );
}
