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

export function CrdtCounters() {
  const [gKey, setGKey] = useState("");
  const [pnKey, setPnKey] = useState("");

  const incG = useCall();
  const getG = useCall();
  const incPn = useCall();
  const decPn = useCall();
  const getPn = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Counters</h2>
        <p className="section-desc">
          Conflict-free counters that merge across nodes.{" "}
          <strong>G-Counter</strong>: grow-only (increment only).{" "}
          <strong>PN-Counter</strong>: supports both increment and decrement.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">
            G-Counter — increment_g_counter / get_g_counter
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="counter key"
              value={gKey}
              onChange={(e) => setGKey(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero"
              disabled={incG.loading}
              onClick={() => incG.run(() => api.incrementGCounter(gKey))}
            >
              {incG.loading ? "..." : "increment"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getG.loading}
              onClick={() => getG.run(() => api.getGCounter(gKey))}
            >
              {getG.loading ? "..." : "get"}
            </button>
          </div>
          <ResultBox result={incG.result} />
          <ResultBox result={getG.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            PN-Counter — increment / decrement / get
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="counter key"
              value={pnKey}
              onChange={(e) => setPnKey(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero"
              disabled={incPn.loading}
              onClick={() => incPn.run(() => api.incrementPnCounter(pnKey))}
            >
              {incPn.loading ? "..." : "+ inc"}
            </button>
            <button
              className="btn-danger-outline"
              disabled={decPn.loading}
              onClick={() => decPn.run(() => api.decrementPnCounter(pnKey))}
            >
              {decPn.loading ? "..." : "− dec"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getPn.loading}
              onClick={() => getPn.run(() => api.getPnCounter(pnKey))}
            >
              {getPn.loading ? "..." : "get"}
            </button>
          </div>
          <ResultBox result={incPn.result} />
          <ResultBox result={decPn.result} />
          <ResultBox result={getPn.result} />
        </div>
      </div>
    </div>
  );
}
