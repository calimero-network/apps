import { useState } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
  useNamespacesForApplication,
} from "@calimero-network/mero-react";
import { BoxIcon, CheckIcon, ChevronRightIcon, LayersIcon, PlusIcon, RefreshIcon } from "./icons";
import { Callout, IconTile, IdField } from "./ui";

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
  // opening one points Mero Vote at a contract that answers none of its
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
  const nsIds = nsList.map(namespaceIdOf).filter((id): id is string => !!id);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Choose a context</h2>
          <p>
            A context is one voting group: its members, its polls and its ballot
            box, replicated to every member&apos;s node. Contexts live inside a
            namespace.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="ghost"
            onClick={() => {
              void refetch();
              void refetchNamespaces();
            }}
            disabled={loading || nsLoading}
          >
            <RefreshIcon size={16} />
            Refresh
          </button>
          {/*
            Kept as the one-click path, and kept FIRST in prominence, because on a
            fresh node it is the only one that can succeed — there is no namespace
            to add a context to yet. The two-step controls below are for
            everything after that.
          */}
          <button onClick={makeBoth} disabled={busy !== null || !applicationId}>
            <PlusIcon size={16} />
            {busy === "both" ? "Creating…" : "Create namespace + context"}
          </button>
        </div>
      </div>

      {!applicationId && (
        <Callout tone="warning">
          <strong>No application id in this session yet</strong>
          <p>
            Waiting for this session to report which application it is bound to —
            until it does, there is no way to tell this app&apos;s contexts from
            any other app&apos;s on this node. If this persists, install the app
            on the node first.
          </p>
        </Callout>
      )}
      {note && (
        <Callout tone="success" icon={<CheckIcon size={18} />}>
          {note}
        </Callout>
      )}
      {failed && <pre className="err">{failed}</pre>}

      <div className="section-head">
        <h3>
          <BoxIcon size={16} />
          Contexts <span className="count">{contexts.length}</span>
        </h3>
      </div>

      {loading && <p className="empty">Loading contexts…</p>}
      {error && <pre className="err">{error.message}</pre>}

      {!loading && applicationId && contexts.length === 0 && (
        <div className="empty-state">
          <IconTile>
            <BoxIcon size={20} />
          </IconTile>
          <strong>No contexts yet</strong>
          {/* No second "Create namespace + context" here: the journey test
              clicks that button by exact name and a duplicate is ambiguous. */}
          <p>
            No contexts for this application on this node yet. Use{" "}
            <strong className="text">Create namespace + context</strong> above to start a
            voting group, or join one with an invitation below.
          </p>
        </div>
      )}

      {contexts.length > 0 && (
        <div className="grid-cards">
          {contexts.map((c) => (
            <div className="card entity-card" key={c.contextId}>
              <div className="entity-top">
                <IconTile accent>
                  <BoxIcon size={18} />
                </IconTile>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="entity-title">Voting context</div>
                  <IdField value={c.contextId} label="context id" />
                </div>
              </div>
              <div className="entity-foot">
                <span className="empty">Polls, members, ballot box</span>
                <button className="sm" onClick={() => select(c.contextId)}>
                  Open
                  <ChevronRightIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head">
        <h3>
          <LayersIcon size={16} />
          Namespaces <span className="count">{nsIds.length}</span>
        </h3>
        <button
          className="ghost sm"
          onClick={makeNamespace}
          disabled={busy !== null || !applicationId}
        >
          <PlusIcon size={14} />
          {busy === "namespace" ? "Creating…" : "Create namespace"}
        </button>
      </div>
      <p className="hint">
        A context must live in a namespace, and a namespace can hold several.
        Members are invited to the <em>namespace</em>, which is why the invite
        link works for everyone in it.
      </p>

      {nsLoading && <p className="empty">Loading namespaces…</p>}
      {nsError && <pre className="err">{nsError.message}</pre>}

      {!nsLoading && nsIds.length === 0 && (
        <div className="empty-state compact">
          <p>No namespaces yet — create one, or use the one-click button above.</p>
        </div>
      )}

      {nsIds.length > 0 && (
        <div className="grid-cards">
          {nsIds.map((id) => (
            <div className="card entity-card" key={id}>
              <div className="entity-top">
                <IconTile>
                  <LayersIcon size={18} />
                </IconTile>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="entity-title">Namespace</div>
                  <IdField value={id} label="namespace id" />
                </div>
              </div>
              <div className="entity-foot">
                <span className="empty">Holds contexts and members</span>
                <button
                  className="ghost sm"
                  disabled={busy !== null}
                  onClick={() => void makeContextIn(id)}
                >
                  <PlusIcon size={14} />
                  {busy === id ? "Creating…" : "Add context"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
