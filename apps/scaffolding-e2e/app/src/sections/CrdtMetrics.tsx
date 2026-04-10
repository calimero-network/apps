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

export function CrdtMetrics() {
  const [pushValue, setPushValue] = useState("0");
  const [getIndex, setGetIndex] = useState("0");

  const pushCall = useCall();
  const getCall = useCall();
  const lenCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Metrics Vector</h2>
        <p className="section-desc">
          A vector of G-Counters. Each position is merged element-wise across
          nodes. Useful for per-node or per-shard metrics aggregation.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">push_metric(value) → index</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value (u64)"
              type="number"
              min="0"
              value={pushValue}
              onChange={(e) => setPushValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={pushCall.loading}
            onClick={() =>
              pushCall.run(() =>
                api.pushMetric(parseInt(pushValue, 10)),
              )
            }
          >
            {pushCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={pushCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_metric(index) / metrics_len()</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="index"
              type="number"
              min="0"
              value={getIndex}
              onChange={(e) => setGetIndex(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-calimero-outline"
              disabled={getCall.loading}
              onClick={() =>
                getCall.run(() =>
                  api.getMetric(parseInt(getIndex, 10)),
                )
              }
            >
              {getCall.loading ? "..." : "get_metric"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={lenCall.loading}
              onClick={() => lenCall.run(() => api.metricsLen())}
            >
              {lenCall.loading ? "..." : "metrics_len"}
            </button>
          </div>
          <ResultBox result={getCall.result} />
          <ResultBox result={lenCall.result} />
        </div>
      </div>
    </div>
  );
}
