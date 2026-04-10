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

export function CrdtTags() {
  const [addKey, setAddKey] = useState("");
  const [addTag, setAddTagVal] = useState("");
  const [hasKey, setHasKey] = useState("");
  const [hasTag, setHasTagVal] = useState("");
  const [countKey, setCountKey] = useState("");

  const addCall = useCall();
  const hasCall = useCall();
  const countCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">CRDT Tags Set</h2>
        <p className="section-desc">
          Union-merge tag sets. Adding a tag is monotonic — once added it
          persists across all nodes. Perfect for labels, categories, or flags.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">add_tag(key, tag)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="tag"
              value={addTag}
              onChange={(e) => setAddTagVal(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={addCall.loading}
            onClick={() => addCall.run(() => api.addTag(addKey, addTag))}
          >
            {addCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={addCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">has_tag(key, tag) → bool</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={hasKey}
              onChange={(e) => setHasKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="tag"
              value={hasTag}
              onChange={(e) => setHasTagVal(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={hasCall.loading}
            onClick={() => hasCall.run(() => api.hasTag(hasKey, hasTag))}
          >
            {hasCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={hasCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_tag_count(key) → u64</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={countKey}
              onChange={(e) => setCountKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={countCall.loading}
            onClick={() => countCall.run(() => api.getTagCount(countKey))}
          >
            {countCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={countCall.result} />
        </div>
      </div>
    </div>
  );
}
