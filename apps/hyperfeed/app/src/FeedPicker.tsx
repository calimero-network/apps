import { useState } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
} from "@calimero-network/mero-react";
import { short } from "./format";

/** rc.25 renamed `groupId` → `namespaceId`; read both. */
function namespaceIdOf(ns: unknown): string | undefined {
  const n = ns as { namespaceId?: string; groupId?: string; id?: string } | null;
  return n?.namespaceId ?? n?.groupId ?? n?.id;
}

/**
 * Open your feed, or make it.
 *
 * Under `AppMode.MultiContext` the session carries no context, so picking one
 * is the app's job. A feed is personal: usually there is exactly one, in a
 * namespace of its own that you never invite anyone to.
 */
export function FeedPicker({ applicationId }: { applicationId: string | null }) {
  const { contexts: reported, loading, error, refetch } = useApplicationContexts(applicationId);
  // Without an application id the hook lists EVERY context on the node; only
  // ours are safe to open.
  const contexts = applicationId ? reported.filter((c) => c.applicationId === applicationId) : [];
  const { createNamespace } = useCreateNamespace();
  const { createContext } = useCreateContext();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function open(id: string) {
    setContextId(id);
    // The provider reads the stored context on mount.
    window.location.reload();
  }

  async function create() {
    if (!applicationId) return;
    setBusy(true);
    setFailed(null);
    try {
      const ns = await createNamespace({ applicationId });
      const namespaceId = namespaceIdOf(ns);
      if (!namespaceId) throw new Error("namespace created but no id came back");
      // `init` takes no arguments.
      const init = Array.from(new TextEncoder().encode("{}"));
      const ctx = await createContext({ applicationId, groupId: namespaceId, initializationParams: init });
      const id = (ctx as { contextId?: string } | null)?.contextId;
      if (!id) throw new Error("context created but no contextId came back");
      open(id);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="center-card">
      <h1>Your feed</h1>
      <p className="muted">
        A feed is a context only you write to. Your agent records what it does there, and this app records
        what your other apps send you.
      </p>
      {loading && <p className="muted">Looking for your feed…</p>}
      {error && <pre className="err">{error.message}</pre>}
      {!loading && !applicationId && (
        <p className="muted">
          Waiting for the session to say which application it is bound to. If it never does, install Hyperfeed
          on the node first.
        </p>
      )}
      {contexts.length > 0 && (
        <ul className="picker">
          {contexts.map((c) => (
            <li key={c.contextId}>
              <button type="button" className="ghost" onClick={() => open(c.contextId)}>
                Open feed <span className="mono">{short(c.contextId)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        {!loading && applicationId && contexts.length === 0 && (
          <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create my feed"}
          </button>
        )}
        <button type="button" className="ghost" disabled={loading} onClick={() => void refetch()}>
          Refresh
        </button>
      </div>
      {failed && <pre className="err">{failed}</pre>}
    </section>
  );
}
