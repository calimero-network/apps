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

export function AuthoredMap() {
  const [insertKey, setInsertKey] = useState("");
  const [insertValue, setInsertValue] = useState("");
  const [updateKey, setUpdateKey] = useState("");
  const [updateValue, setUpdateValue] = useState("");
  const [removeKey, setRemoveKey] = useState("");
  const [getKey, setGetKey] = useState("");
  const [ownerKey, setOwnerKey] = useState("");

  const insert = useCall();
  const update = useCall();
  const remove = useCall();
  const get = useCall();
  const entries = useCall();
  const getOwner = useCall();
  const len = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Authored Map</h2>
        <p className="section-desc">
          Shared-keyspace map where ownership is per-entry. The node that
          inserts a key becomes its owner — only that node can update or remove
          it. Anyone can read. Ownership is enforced at merge time via the
          Calimero CRDT layer.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">authored_insert(key, value)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Insert a new key. Caller becomes the owner. Fails if the key already exists.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={insertKey}
              onChange={(e) => setInsertKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={insertValue}
              onChange={(e) => setInsertValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={insert.loading}
            onClick={() => insert.run(() => api.authoredInsert(insertKey, insertValue))}
          >
            {insert.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={insert.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_update(key, value)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Update an existing key. Only the owning node can call this.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={updateKey}
              onChange={(e) => setUpdateKey(e.target.value)}
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
            onClick={() => update.run(() => api.authoredUpdate(updateKey, updateValue))}
          >
            {update.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={update.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_remove(key)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Remove an entry. Only the owning node can remove its own entry.
            Returns the removed value, or null if the key didn't exist.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={removeKey}
              onChange={(e) => setRemoveKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={remove.loading}
            onClick={() => remove.run(() => api.authoredRemove(removeKey))}
          >
            {remove.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={remove.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_get(key)</div>
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
            disabled={get.loading}
            onClick={() => get.run(() => api.authoredGet(getKey))}
          >
            {get.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={get.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_entries()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns all key→value pairs visible in this context.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={entries.loading}
            onClick={() => entries.run(() => api.authoredEntries())}
          >
            {entries.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={entries.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_get_owner(key)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns the 64-hex account id of the member that owns this entry — an account (a person), not a base58 device key.
          </p>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="key"
                value={ownerKey}
                onChange={(e) => setOwnerKey(e.target.value)}
              />
              <FieldHelp text="Ownership is set at insert time and stored in the CRDT metadata. Only the owner's node can update or remove this entry." />
            </div>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getOwner.loading}
            onClick={() => getOwner.run(() => api.authoredGetOwner(ownerKey))}
          >
            {getOwner.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getOwner.result} />
        </div>

        <div className="method-card">
          <div className="method-name">authored_len()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Total number of entries in the map.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={len.loading}
            onClick={() => len.run(() => api.authoredLen())}
          >
            {len.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={len.result} />
        </div>
      </div>
    </div>
  );
}
