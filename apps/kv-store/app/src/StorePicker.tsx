import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, type AppSource } from "@calimero-apps/connect";
import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";

import { PACKAGE } from "./session";
import { createStore, listStores } from "./stores";

const CREATE_LABELS = {
  title: "New shared store",
  subtitle: "Name your store. It lives in an organization of its own, whose members you can invite.",
  nameLabel: "Store name",
  namePlaceholder: "e.g. team",
  selfLabel: "Your name in this store",
  selfPlaceholder: "e.g. Alice",
};

/** v1's context picker: the stores this account reaches, and a new one. */
export function StorePicker({
  client,
  accountId,
  source,
  passkey,
  onOpen,
  after,
}: {
  client: CalimeroClient;
  accountId: string;
  source: AppSource;
  passkey: () => PasskeyProvider;
  onOpen: (app: AppInfo) => void;
  /** Runs after each request (keeps the stored session current). */
  after: () => void;
}) {
  const [stores, setStores] = useState<AppInfo[] | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { source: release, pending: releasePending } = useResolvedSource(client, accountId, source);
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

  /** A private store needs no org; a shared one gets the one the shared dialog made (`org`). */
  async function create(name: string, org?: string, selfName?: string) {
    setBusy(true);
    setError(null);
    try {
      const appId = await createStore(client, source, name, org);
      after();
      // Best effort: the store exists either way.
      if (org && selfName) await setOrgName(client, org, accountId, selfName).catch(() => {});
      const created = (await listStores(client, source)).find((a) => a.appId === appId);
      onOpen(created ?? { appId, name, owner: "", org: org ?? null, bundle: "", package: null, version: null });
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
            if (shared) setShowCreate(true);
            else if (name.trim()) void create(name.trim());
          }}
        >
          {!shared && (
            <input placeholder="name" aria-label="store name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <label className="empty" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              style={{ flex: "0 0 auto" }}
            />
            shared (others can be invited)
          </label>
          <button type="submit" disabled={busy || (!shared && !name.trim())}>
            Create
          </button>
        </form>
        {error && <pre className="err">{error}</pre>}
      </div>
      <CreateWorkspaceDialog
        client={client}
        passkey={passkey()}
        release={releasePending ? null : (reviewRelease(release) ?? { package: PACKAGE })}
        defaultSelfName={lastUsedName()}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={({ orgId, name: title, selfName }) => {
          setShowCreate(false);
          void create(title, orgId, selfName);
        }}
        labels={CREATE_LABELS}
      />
    </>
  );
}
