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

export function CrdtRegisters() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [getKey, setGetKey] = useState("");

  const setCall = useCall();
  const getCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Registers</h2>
        <p className="section-desc">
          Last-Write-Wins (LWW) registers. On concurrent writes the most recent
          timestamp wins during merge.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">set_register(key, value)</div>
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
            onClick={() => setCall.run(() => api.setRegister(key, value))}
          >
            {setCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_register(key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={getKey}
              onChange={(e) => setGetKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getCall.loading}
            onClick={() => getCall.run(() => api.getRegister(getKey))}
          >
            {getCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getCall.result} />
        </div>
      </div>
    </div>
  );
}
