import { useState } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateGroupInNamespace,
  useCreateNamespace,
} from "@calimero-network/mero-react";

/**
 * Choose which context this session talks to, or make one.
 *
 * Under `AppMode.MultiContext` the auth callback hands back tokens and an
 * application id and nothing else, so context selection is the app's job. This
 * is the smallest honest version of it.
 *
 * A context lives inside a namespace — there is no bare-context path since
 * rc.21, and `createContext` requires a group id. So "create" here is three
 * calls, not one: namespace → group → context.
 */
export function ContextPicker({ applicationId }: { applicationId: string | null }) {
  const { contexts, loading, error, refetch } = useApplicationContexts(applicationId);
  const { createNamespace } = useCreateNamespace();
  const { createGroupInNamespace } = useCreateGroupInNamespace();
  const { createContext } = useCreateContext();

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function create() {
    if (!applicationId) return;
    setBusy(true);
    setFailed(null);
    try {
      const ns = await createNamespace({ applicationId });
      // rc.25 renamed this field from `groupId` to `namespaceId`. Read both:
      // the rename produced `undefined` with nothing erroring, and a client
      // one version out of step silently passes `undefined` as a group id.
      const namespaceId =
        (ns as { namespaceId?: string; groupId?: string } | null)?.namespaceId ??
        (ns as { groupId?: string } | null)?.groupId;
      if (!namespaceId) throw new Error("namespace created but no id came back");

      const group = await createGroupInNamespace(namespaceId, { name: "kv-store" });
      const groupId =
        (group as { groupId?: string; id?: string } | null)?.groupId ??
        (group as { id?: string } | null)?.id ??
        namespaceId;

      const ctx = await createContext({ applicationId, groupId });
      const newContextId = (ctx as { contextId?: string } | null)?.contextId;
      if (!newContextId) throw new Error("context created but no contextId came back");

      select(newContextId);
    } catch (e) {
      // Surfaced rather than swallowed on purpose: a bare 500 from
      // `POST /contexts` means the contract's `init` rejected the params, and
      // core hides untyped errors deliberately. Hiding it again in the UI
      // leaves nothing to debug.
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function select(id: string) {
    setContextId(id);
    // The provider reads the stored context on mount, so a reload is the
    // simplest correct way to adopt it without duplicating that logic here.
    window.location.reload();
  }

  return (
    <div className="card">
      <h2>Choose a context</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        A context is one replicated instance of this contract&apos;s state. Every
        member of a context converges on the same map.
      </p>

      {loading && <p className="empty">Loading contexts…</p>}
      {error && <pre className="err">{error.message}</pre>}

      {!loading && contexts.length === 0 && (
        <p className="empty">No contexts for this application on this node yet.</p>
      )}

      {contexts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>context</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contexts.map((c) => (
              <tr key={c.contextId}>
                <td className="mono">{c.contextId}</td>
                <td style={{ textAlign: "right" }}>
                  <button onClick={() => select(c.contextId)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={create} disabled={busy || !applicationId}>
          {busy ? "Creating…" : "Create a context"}
        </button>
        <button className="ghost" onClick={() => void refetch()} disabled={loading}>
          Refresh
        </button>
      </div>

      {!applicationId && (
        <p className="empty" style={{ marginTop: 12 }}>
          No application id in this session — install the app on the node first.
        </p>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
