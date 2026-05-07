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

export function AuthoredVector() {
  const [pushValue, setPushValue] = useState("");
  const [getIndex, setGetIndex] = useState("");
  const [updateIndex, setUpdateIndex] = useState("");
  const [updateValue, setUpdateValue] = useState("");
  const [removeIndex, setRemoveIndex] = useState("");
  const [ownerIndex, setOwnerIndex] = useState("");

  const push = useCall();
  const get = useCall();
  const update = useCall();
  const remove = useCall();
  const getOwner = useCall();
  const entries = useCall();
  const len = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Authored Vector</h2>
        <p className="section-desc">
          Append-only vector with per-slot ownership. The node that pushes an
          entry becomes its owner — only that node can update or tombstone it.
          Indices are stable; tombstoned slots remain as empty strings.
          Ownership is enforced at merge time via the Calimero CRDT layer.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">authored_vec_push(value)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Append a new entry. Caller becomes the owner. Returns the assigned index.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value"
              value={pushValue}
              onChange={(e) => setPushValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={push.loading}
            onClick={() => push.run(() => api.authoredVecPush(pushValue))}
          >
            {push.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={push.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_get(index)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="index"
              type="number"
              value={getIndex}
              onChange={(e) => setGetIndex(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={get.loading}
            onClick={() => get.run(() => api.authoredVecGet(Number(getIndex)))}
          >
            {get.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={get.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_update(index, value)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Replace the value at an index. Only the owning node can call this.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="index"
              type="number"
              value={updateIndex}
              onChange={(e) => setUpdateIndex(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="new value"
              value={updateValue}
              onChange={(e) => setUpdateValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={update.loading}
            onClick={() =>
              update.run(() => api.authoredVecUpdate(Number(updateIndex), updateValue))
            }
          >
            {update.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={update.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_remove(index)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Tombstone the entry at an index. Only the owning node can remove its
            own slot. The slot is preserved as an empty string.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="index"
              type="number"
              value={removeIndex}
              onChange={(e) => setRemoveIndex(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={remove.loading}
            onClick={() => remove.run(() => api.authoredVecRemove(Number(removeIndex)))}
          >
            {remove.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={remove.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_get_owner(index)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns the base58 public key of the node that owns this slot.
          </p>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="index"
                type="number"
                value={ownerIndex}
                onChange={(e) => setOwnerIndex(e.target.value)}
              />
              <FieldHelp text="Ownership is stamped at push time and stored in CRDT metadata. Only the owner's node can update or tombstone this slot." />
            </div>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getOwner.loading}
            onClick={() => getOwner.run(() => api.authoredVecGetOwner(Number(ownerIndex)))}
          >
            {getOwner.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getOwner.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_entries()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns all slots in insertion order. Tombstoned slots appear as empty strings.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={entries.loading}
            onClick={() => entries.run(() => api.authoredVecEntries())}
          >
            {entries.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={entries.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_vec_len()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Total number of slots (including tombstoned).
          </p>
          <button
            className="btn-calimero-outline"
            disabled={len.loading}
            onClick={() => len.run(() => api.authoredVecLen())}
          >
            {len.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={len.result} />
        </div>
      </div>
    </div>
  );
}
