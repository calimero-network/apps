import { useState, type ReactNode } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
  useNamespacesForApplication,
} from "@calimero-network/mero-react";
import { Portrait } from "./FighterSelect";
import { ROSTER } from "./game/fighters";

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

function arenaInit(): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify({ title: "Arena", now: Date.now() })));
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function ContextPicker({
  applicationId,
  children,
}: {
  applicationId: string | null;
  /** Drawn in the side column — the join-by-invitation card. */
  children?: ReactNode;
}) {
  const {
    contexts: reportedContexts,
    loading,
    error,
    refetch,
  } = useApplicationContexts(applicationId);

  // ⚠️ `useApplicationContexts` does NOT stay application-scoped when the id is
  // missing. It delegates to `useContexts`, which branches:
  //
  //   applicationId ? getContextsForApplication(applicationId) : getContexts()
  //
  // and `getContexts()` is every context on the node. So before the session
  // resolves an application id, this table silently listed other apps'
  // contexts under the heading "No contexts for this application" — and
  // opening one points Mero Kombat at a contract that answers none of its
  // methods.
  //
  // Note the asymmetry with `useNamespacesForApplication` right below, which
  // fetches NOTHING without an id. Two hooks, opposite answers to the same
  // missing input; this one guesses. Filtering here rather than trusting the
  // hook: "I cannot tell which are mine" and "all of them are mine" are
  // different answers, and only the first one is safe.
  const contexts = applicationId
    ? reportedContexts.filter((c) => c.applicationId === applicationId)
    : [];
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
      const ctx = await createContext({ applicationId, groupId: namespaceId, initializationParams: arenaInit() });
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
      const ctx = await createContext({ applicationId, groupId: namespaceId, initializationParams: arenaInit() });
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
    <div className="lobby">
      <section className="lobby-hero">
        <div className="lobby-copy">
          <p className="eyebrow">Lobby</p>
          <h1>Enter the arena</h1>
          <p className="lede">
            An arena is one Calimero context: two corners and every blow thrown,
            replicated between both fighters&apos; nodes. No game server — each
            punch is a transaction the contract executes on your own node.
          </p>
          <div className="row">
            {/*
              Kept as the one-click path, and kept FIRST, because on a fresh node
              it is the only one that can succeed — there is no namespace to add a
              context to yet. The two-step controls below are for everything after
              that.
            */}
            <button className="large" onClick={makeBoth} disabled={busy !== null || !applicationId}>
              {busy === "both" ? "Creating…" : "New arena"}
            </button>
            <button
              className="ghost large"
              onClick={() => {
                void refetch();
                void refetchNamespaces();
              }}
              disabled={loading || nsLoading}
            >
              Refresh
            </button>
          </div>
          {note && <p className="hint">{note}</p>}
          {failed && <pre className="err">{failed}</pre>}
        </div>
        <LobbyArt />
      </section>

      <div className="lobby-grid">
        <div className="card tables-card">
          <div className="card-head">
            <h2>Choose an arena</h2>
            {contexts.length > 0 && <span className="count">{contexts.length}</span>}
          </div>

          {loading && <p className="empty">Loading contexts…</p>}
          {error && <pre className="err">{error.message}</pre>}

          {!loading && !applicationId && (
            <p className="empty">
              Waiting for this session to report which application it is bound to —
              until it does, there is no way to tell this app&apos;s contexts from
              any other app&apos;s on this node. If it never arrives, install the
              app on the node first.
            </p>
          )}

          {!loading && applicationId && contexts.length === 0 && (
            <div className="empty-state">
              <Portrait id="kinetic" size={64} className="empty-piece" />
              <p>No arenas on this node yet.</p>
              <p className="hint">Start one with New arena, or join one with an invitation.</p>
            </div>
          )}

          {contexts.length > 0 && (
            <ul className="table-list">
              {contexts.map((c, i) => (
                <li key={c.contextId}>
                  <button className="table-item" onClick={() => select(c.contextId)}>
                    <span className="table-icon" aria-hidden="true">
                      <Portrait id={ROSTER[i % ROSTER.length].id} size={44} />
                    </span>
                    <span className="table-text">
                      <span className="table-title">Arena {i + 1}</span>
                      <span className="table-id mono" title={c.contextId}>
                        {c.contextId}
                      </span>
                    </span>
                    <span className="open">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lobby-side">
          {children}

          <div className="card ns-card">
            <div className="card-head">
              <h2>Namespaces</h2>
              <button
                className="ghost small"
                onClick={makeNamespace}
                disabled={busy !== null || !applicationId}
              >
                {busy === "namespace" ? "Creating…" : "Create namespace"}
              </button>
            </div>
            <p className="hint">
              A namespace is a dojo and each context in it is an arena. Members are
              invited to the <em>namespace</em>, which is why one invite link lets
              someone into every arena in it.
            </p>

            {nsLoading && <p className="empty">Loading namespaces…</p>}
            {nsError && <pre className="err">{nsError.message}</pre>}

            {!nsLoading && nsList.length === 0 && (
              <p className="empty">No namespaces yet — New arena creates one for you.</p>
            )}

            {nsList.length > 0 && (
              <ul className="ns-list">
                {nsList.map((ns, i) => {
                  const id = namespaceIdOf(ns);
                  if (!id) return null;
                  return (
                    <li key={id ?? i}>
                      <span className="mono ns-id" title={id}>
                        {id}
                      </span>
                      <button
                        className="ghost small"
                        disabled={busy !== null}
                        onClick={() => void makeContextIn(id)}
                      >
                        {busy === id ? "Creating…" : "Add arena"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Two fighters squaring up — what the lobby is about. */
function LobbyArt() {
  return (
    <div className="lobby-art" aria-hidden="true">
      <Portrait id="kinetic" size={132} />
      <span className="lobby-vs">VS</span>
      <Portrait id="inferno" size={132} facing={-1} />
    </div>
  );
}
