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

export function SharedStorage() {
  const [setValue, setSetValue] = useState("");
  const [addWriterKey, setAddWriterKey] = useState("");
  const [isWriterKey, setIsWriterKey] = useState("");

  const set = useCall();
  const get = useCall();
  const getWriters = useCall();
  const addWriter = useCall();
  const isWriter = useCall();
  const isFrozen = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Shared Storage</h2>
        <p className="section-desc">
          Single-value storage with an explicit writer set. Only callers whose{" "}
          <strong>account</strong> is in the writer set can call{" "}
          <code>shared_set</code>. The writer set is rotatable. The node that
          initialized the context is the first writer; additional writers must
          be added via <code>shared_add_writer</code> before they can write.
        </p>
        <p className="section-desc">
          Note the identity: this set is keyed by <strong>account id</strong>{" "}
          (64 hex characters), not by the device key shown in the context
          bar and reported by the <code>authored_*</code> methods. Core 0.11
          split the two, and only the account authorizes. Call{" "}
          <code>whoami</code> to get yours — nothing on the wire maps a device
          key to an account, so a peer has to hand you theirs.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">shared_set(value)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Overwrite the shared value. Only authorized writers can call this.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value"
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={set.loading}
            onClick={() => set.run(() => api.sharedSet(setValue))}
          >
            {set.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={set.result} />
        </div>

        <div className="method-card">
          <div className="method-name">shared_get()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Read the current shared value. Any context member can call this.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={get.loading}
            onClick={() => get.run(() => api.sharedGet())}
          >
            {get.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={get.result} />
        </div>

        <div className="method-card">
          <div className="method-name">shared_get_writers()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            List all account ids authorized to write. The init node is
            always the first entry.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={getWriters.loading}
            onClick={() => getWriters.run(() => api.sharedGetWriters())}
          >
            {getWriters.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getWriters.result} />
        </div>

        <div className="method-card">
          <div className="method-name">shared_add_writer(account_hex)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Add a new writer by account id. Only existing writers can expand the
            writer set.
          </p>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="64-hex account id"
                value={addWriterKey}
                onChange={(e) => setAddWriterKey(e.target.value)}
              />
              <FieldHelp text="An account id: 64 hex characters. Get it from shared_get_writers (for an existing writer) or from whoami (for yourself). NOT the executor key in the context bar — that is the device id, and granting it silently authorizes nobody. Since core rc.27 both are 64 hex, so nothing about the value will warn you." />
            </div>
          </div>
          <button
            className="btn-calimero"
            disabled={addWriter.loading}
            onClick={() => addWriter.run(() => api.sharedAddWriter(addWriterKey))}
          >
            {addWriter.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={addWriter.result} />
        </div>

        <div className="method-card">
          <div className="method-name">shared_is_writer(account_hex)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Check whether a given account is an authorized writer.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="64-hex account id"
              value={isWriterKey}
              onChange={(e) => setIsWriterKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={isWriter.loading}
            onClick={() => isWriter.run(() => api.sharedIsWriter(isWriterKey))}
          >
            {isWriter.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={isWriter.result} />
        </div>

        <div className="method-card">
          <div className="method-name">shared_is_frozen()</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns true if this storage has been permanently locked (frozen flag
            was set to true at construction).
          </p>
          <button
            className="btn-calimero-outline"
            disabled={isFrozen.loading}
            onClick={() => isFrozen.run(() => api.sharedIsFrozen())}
          >
            {isFrozen.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={isFrozen.result} />
        </div>
      </div>
    </div>
  );
}
