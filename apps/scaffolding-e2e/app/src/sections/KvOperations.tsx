import { useState } from "react";
import * as api from "../api/kvStore";

function ResultBox({ result }: { result: unknown }) {
  if (result === undefined) return null;
  const isError =
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error: unknown }).error !== null;
  return (
    <pre className={`result-box${isError ? " error" : ""}`}>
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

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

  const setCall = useCall();
  const getCall = useCall();
  const getResultCall = useCall();
  const entriesCall = useCall();
  const lenCall = useCall();
  const removeCall = useCall();
  const clearCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">KV Operations</h2>
        <p className="section-desc">
          Basic key-value store: set, get, list, remove, clear.
        </p>
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
            onClick={() => setCall.run(() => api.kvSet(key, value))}
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
          <div className="method-name">entries() / len()</div>
          <div className="input-row">
            <button
              className="btn-calimero-outline"
              disabled={entriesCall.loading}
              onClick={() => entriesCall.run(() => api.kvEntries())}
            >
              {entriesCall.loading ? "..." : "entries"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={lenCall.loading}
              onClick={() => lenCall.run(() => api.kvLen())}
            >
              {lenCall.loading ? "..." : "len"}
            </button>
          </div>
          <ResultBox result={entriesCall.result} />
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
            onClick={() => removeCall.run(() => api.kvRemove(removeKey))}
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
            onClick={() => clearCall.run(() => api.kvClear())}
          >
            {clearCall.loading ? "..." : "clear"}
          </button>
          <ResultBox result={clearCall.result} />
        </div>
      </div>
    </div>
  );
}
