import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import { describeError, type AppSource } from "@calimero-apps/connect";

import { createInstance, listInstances } from "./instances";

/** v1's context picker: the instances of this app the account reaches, and a new one. */
export function InstancePicker({
  client,
  source,
  onOpen,
  after,
}: {
  client: CalimeroClient;
  source: AppSource;
  onOpen: (app: AppInfo) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [instances, setInstances] = useState<AppInfo[] | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInstances(await listInstances(client, source));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const appId = await createInstance(client, source, name.trim(), shared);
      after();
      const created = (await listInstances(client, source)).find((a) => a.appId === appId);
      onOpen(
        created ?? { appId, name: name.trim(), owner: "", org: null, bundle: "", package: null, version: null },
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="method-card" style={{ marginBottom: 16 }}>
        <div className="method-name">Your instances</div>
        {instances === null ? (
          <p className="method-hint">Loading…</p>
        ) : instances.length === 0 ? (
          <p className="method-hint">None yet: create one below, or open an invitation link someone sent you.</p>
        ) : (
          <table>
            <tbody>
              {instances.map((s) => (
                <tr key={s.appId}>
                  <td>{s.name}</td>
                  <td className="method-hint">{s.org ? "shared" : "private"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn-calimero-outline" onClick={() => onOpen(s)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="method-card" style={{ marginBottom: 16 }}>
        <div className="method-name">New instance</div>
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <input className="form-control" placeholder="name" aria-label="instance name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="method-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              style={{ flex: "0 0 auto" }}
            />
            shared (others can be invited)
          </label>
          <button className="btn-calimero" type="submit" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
        {error && <pre className="result-box error">{error}</pre>}
      </div>
    </>
  );
}
