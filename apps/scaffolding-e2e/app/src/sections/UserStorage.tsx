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

export function UserStorage() {
  const [simpleValue, setSimpleValue] = useState("");
  const [forUserKey, setForUserKey] = useState("");
  const [nestedKey, setNestedKey] = useState("");
  const [nestedValue, setNestedValue] = useState("");
  const [getNestedKey, setGetNestedKey] = useState("");

  const setSimple = useCall();
  const getSimple = useCall();
  const getSimpleFor = useCall();
  const setNested = useCall();
  const getNested = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">User Storage</h2>
        <p className="section-desc">
          Per-user isolated storage. Each user's data is private to their
          identity.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">set_user_simple(value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value"
              value={simpleValue}
              onChange={(e) => setSimpleValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setSimple.loading}
            onClick={() =>
              setSimple.run(() => api.setUserSimple(simpleValue))
            }
          >
            {setSimple.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setSimple.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_user_simple()</div>
          <p
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginBottom: 10,
            }}
          >
            Returns the current user's stored value.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={getSimple.loading}
            onClick={() => getSimple.run(() => api.getUserSimple())}
          >
            {getSimple.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getSimple.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_user_simple_for(user_key)</div>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="user public key (base58)"
                value={forUserKey}
                onChange={(e) => setForUserKey(e.target.value)}
              />
              <FieldHelp text="The base58-encoded Ed25519 public key of another context member. Get it from ws_list_members, or from their node's context bar (executor key)." />
            </div>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getSimpleFor.loading}
            onClick={() =>
              getSimpleFor.run(() => api.getUserSimpleFor(forUserKey))
            }
          >
            {getSimpleFor.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getSimpleFor.result} />
        </div>

        <div className="method-card">
          <div className="method-name">set_user_nested(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={nestedKey}
              onChange={(e) => setNestedKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={nestedValue}
              onChange={(e) => setNestedValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setNested.loading}
            onClick={() =>
              setNested.run(() => api.setUserNested(nestedKey, nestedValue))
            }
          >
            {setNested.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setNested.result} />
        </div>

        <div className="method-card">
          <div className="method-name">get_user_nested(key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={getNestedKey}
              onChange={(e) => setGetNestedKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getNested.loading}
            onClick={() =>
              getNested.run(() => api.getUserNested(getNestedKey))
            }
          >
            {getNested.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getNested.result} />
        </div>
      </div>
    </div>
  );
}
