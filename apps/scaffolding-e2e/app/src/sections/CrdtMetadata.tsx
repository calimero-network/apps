import { useState } from "react";
import { ResultBox } from "../components/ResultBox";
import * as api from "../api/kvStore";
import { FieldHelp } from "../components/FieldHelp";


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
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="outer_key (top-level bucket, e.g. user_id)"
                value={outerKey}
                onChange={(e) => setOuterKey(e.target.value)}
              />
              <FieldHelp text="The top-level key — think of it as a row identifier, e.g. a user ID or entity name. All inner_keys under the same outer_key form a sub-map." />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="inner_key (field name, e.g. email)"
                value={innerKey}
                onChange={(e) => setInnerKey(e.target.value)}
              />
              <FieldHelp text="The field name within the outer_key bucket, e.g. 'email', 'status'. Each outer_key+inner_key pair stores one LWW-register value." />
            </div>
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
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="outer_key"
                value={getOuter}
                onChange={(e) => setGetOuter(e.target.value)}
              />
              <FieldHelp text="Same outer_key you used in set_metadata — the top-level bucket identifier." />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="inner_key"
                value={getInner}
                onChange={(e) => setGetInner(e.target.value)}
              />
              <FieldHelp text="Same inner_key you used in set_metadata — the field name within the outer_key bucket." />
            </div>
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
