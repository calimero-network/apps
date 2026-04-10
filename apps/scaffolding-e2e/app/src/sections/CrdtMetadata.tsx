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

export function CrdtMetadata() {
  const [outerKey, setOuterKey] = useState("");
  const [innerKey, setInnerKey] = useState("");
  const [value, setValue] = useState("");
  const [getOuter, setGetOuter] = useState("");
  const [getInner, setGetInner] = useState("");

  const setCall = useCall();
  const getCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Nested Maps (Metadata)</h2>
        <p className="section-desc">
          Two-level nested maps. Each inner entry is a LWW register. Useful for
          structured metadata like{" "}
          <code>{"{ user_id: { field: value } }"}</code>.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">
            set_metadata(outer_key, inner_key, value)
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="outer_key"
              value={outerKey}
              onChange={(e) => setOuterKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="inner_key"
              value={innerKey}
              onChange={(e) => setInnerKey(e.target.value)}
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
            onClick={() =>
              setCall.run(() => api.setMetadata(outerKey, innerKey, value))
            }
          >
            {setCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_metadata(outer_key, inner_key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="outer_key"
              value={getOuter}
              onChange={(e) => setGetOuter(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="inner_key"
              value={getInner}
              onChange={(e) => setGetInner(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getCall.loading}
            onClick={() =>
              getCall.run(() => api.getMetadata(getOuter, getInner))
            }
          >
            {getCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getCall.result} />
        </div>
      </div>
    </div>
  );
}
