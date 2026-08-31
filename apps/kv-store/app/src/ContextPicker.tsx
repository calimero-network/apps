import { useState } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
  useNamespacesForApplication,
} from "@calimero-network/mero-react";

/**
 * Choose which context this session talks to, or make one.
 *
 * Under `AppMode.MultiContext` the auth callback hands back tokens and an
 * application id and nothing else, so context selection is the app's job.
 *
 * A context lives inside a NAMESPACE — there is no bare-context path since
 * rc.21, and `createContext` requires a group id. That is the single fact this
 * card exists to make visible: the first version offered one "Create a context"
 * button that quietly did both calls, so when it failed there was no way to tell
 * which half failed, and no way to put a second context in a namespace you
 * already had. Both steps are now separate and both are shown.
 */

/** rc.25 renamed this field `groupId` -> `namespaceId`, and read the wrong one
 *  it is `undefined` with nothing erroring — a client one version out of step
 *  then passes `undefined` as a group id. Read both, everywhere. */
function namespaceIdOf(ns: unknown): string | undefined {
  const n = ns as { namespaceId?: string; groupId?: string; id?: string } | null;
  return n?.namespaceId ?? n?.groupId ?? n?.id;
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function ContextPicker({ applicationId }: { applicationId: string | null }) {
  const { contexts, loading, error, refetch } = useApplicationContexts(applicationId);
  const {
    namespaces,
    loading: nsLoading,
    error: nsError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId);
  const { createNamespace } = useCreateNamespace();
  const { createContext } = useCreateContext();

  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function select(id: string) {
    setContextId(id);
    // The provider reads the stored context on mount, so a reload is the
    // simplest correct way to adopt it without duplicating that logic here.
    window.location.reload();
  }

  /** Step 1 on its own, so a namespace can be reused for several contexts. */
  async function makeNamespace() {
    if (!applicationId) return;
    setBusy("namespace");
    setFailed(null);
    setNote(null);
    try {
      const ns = await createNamespace({ applicationId });
      const namespaceId = namespaceIdOf(ns);
      if (!namespaceId) throw new Error("namespace created but no id came back");
      await refetchNamespaces();
      setNote(`Namespace ${shortId(namespaceId)} created — now add a context to it.`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Step 2, against a namespace that already exists. */
  async function makeContextIn(namespaceId: string) {
    if (!applicationId) return;
    setBusy(namespaceId);
    setFailed(null);
    setNote(null);
    try {
      // Directly in the namespace, NOT in a subgroup of it. Two reasons: it is
      // what the merobox scenarios do (`create_context` with
      // `group_id: namespace_id`), and it keeps a context's group equal to its
      // namespace — which is what lets `InviteCard` mint a namespace invitation
      // from `useContextGroup` alone. A subgroup here would hand
      // `createNamespaceInvitation` a subgroup id and fail confusingly.
      const ctx = await createContext({ applicationId, groupId: namespaceId });
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
      setBusy(null);
    }
  }

  /** Both steps, for the very first run when there is nothing at all. */
  async function makeBoth() {
    if (!applicationId) return;
    setBusy("both");
    setFailed(null);
    setNote(null);
    try {
      const ns = await createNamespace({ applicationId });
      const namespaceId = namespaceIdOf(ns);
      if (!namespaceId) throw new Error("namespace created but no id came back");
      const ctx = await createContext({ applicationId, groupId: namespaceId });
      const newContextId = (ctx as { contextId?: string } | null)?.contextId;
      if (!newContextId) throw new Error("context created but no contextId came back");
      select(newContextId);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const nsList = (namespaces ?? []) as unknown[];

  return (
    <>
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
          {/*
            Kept as the one-click path, and kept FIRST, because on a fresh node
            it is the only one that can succeed — there is no namespace to add a
            context to yet. The two-step controls below are for everything after
            that.
          */}
          <button onClick={makeBoth} disabled={busy !== null || !applicationId}>
            {busy === "both" ? "Creating…" : "Create namespace + context"}
          </button>
          <button
            className="ghost"
            onClick={() => {
              void refetch();
              void refetchNamespaces();
            }}
            disabled={loading || nsLoading}
          >
            Refresh
          </button>
        </div>

        {!applicationId && (
          <p className="empty" style={{ marginTop: 12 }}>
            No application id in this session — install the app on the node first.
          </p>
        )}
        {note && <p className="empty" style={{ marginTop: 12 }}>{note}</p>}
        {failed && <pre className="err">{failed}</pre>}
      </div>

      <div className="card">
        <h2>Namespaces</h2>
        <p className="empty" style={{ marginBottom: 14 }}>
          A context must live in a namespace, and a namespace can hold several.
          Members are invited to the <em>namespace</em>, which is why the invite
          link works for everyone in it.
        </p>

        {nsLoading && <p className="empty">Loading namespaces…</p>}
        {nsError && <pre className="err">{nsError.message}</pre>}

        {!nsLoading && nsList.length === 0 && (
          <p className="empty">No namespaces yet — create one below, or use the one-click button above.</p>
        )}

        {nsList.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>namespace</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nsList.map((ns, i) => {
                const id = namespaceIdOf(ns);
                if (!id) return null;
                return (
                  <tr key={id ?? i}>
                    <td className="mono">{id}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="ghost"
                        disabled={busy !== null}
                        onClick={() => void makeContextIn(id)}
                      >
                        {busy === id ? "Creating…" : "Add context"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="ghost"
            onClick={makeNamespace}
            disabled={busy !== null || !applicationId}
          >
            {busy === "namespace" ? "Creating…" : "Create namespace"}
          </button>
        </div>
      </div>
    </>
  );
}
