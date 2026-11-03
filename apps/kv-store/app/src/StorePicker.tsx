import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";
import { describeError, type AppSource } from "@calimero-apps/connect";

import { createStore, listStores } from "./stores";

/** v1's context picker: the stores this account reaches, and a new one. */
export function StorePicker({
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
  const [stores, setStores] = useState<AppInfo[] | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStores(await listStores(client, source));
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
      const appId = await createStore(client, source, name.trim(), shared);
      after();
      const created = (await listStores(client, source)).find((a) => a.appId === appId);
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
      <div className="card">
        <h2>Your stores</h2>
        {stores === null ? (
          <p className="empty">Loading…</p>
        ) : stores.length === 0 ? (
          <p className="empty">None yet: create one below, or open an invitation link someone sent you.</p>
        ) : (
          <table>
            <tbody>
              {stores.map((s) => (
                <tr key={s.appId}>
                  <td>{s.name}</td>
                  <td className="empty">{s.org ? "shared" : "private"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="ghost" onClick={() => onOpen(s)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>New store</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <input placeholder="name" aria-label="store name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="empty" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              style={{ flex: "0 0 auto" }}
            />
            shared (others can be invited)
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
        {error && <pre className="err">{error}</pre>}
      </div>
    </>
  );
}
