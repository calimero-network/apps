import { useState } from "react";
import { ResultBox } from "../components/ResultBox";
import * as api from "../api/kvStore";


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

export function FrozenStorage() {
  const [addValue, setAddValue] = useState("");
  const [hash, setHash] = useState("");

  const addCall = useCall();
  const getCall = useCall();

  function handleAdd() {
    addCall.run(async () => {
      const res = await api.addFrozen(addValue);
      if (res.result?.output) setHash(res.result.output);
      return res;
    });
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Frozen Storage</h2>
        <p className="section-desc">
          Content-addressed immutable storage. Values are stored by SHA256 hash
          and cannot be mutated.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">add_frozen(value) → hash</div>
          <div className="method-inputs">
            <textarea
              className="form-control"
              placeholder="value to store (returns SHA256 hash)"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={addCall.loading}
            onClick={handleAdd}
          >
            {addCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={addCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_frozen(hash_hex)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="SHA256 hash (hex)"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getCall.loading}
            onClick={() => getCall.run(() => api.getFrozen(hash))}
          >
            {getCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getCall.result} />
        </div>
      </div>
    </div>
  );
}
