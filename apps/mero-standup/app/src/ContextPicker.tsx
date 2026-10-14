import { useEffect, useState } from "react";
import {
  setContextId,
  useApplicationContexts,
  useCreateContext,
  useCreateNamespace,
  useMero,
  useNamespacesForApplication,
} from "@calimero-network/mero-react";
import { StandupClient } from "./generated/StandupClient";

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

/** Why the last action failed: a message of our own, or whichever hook's `error` to show. */
type Failure =
  | { kind: "message"; message: string }
  | { kind: "hook"; hook: "namespace" | "context" };

/** Thrown when a mutation hook resolved `null`: the real error is in the hook's state. */
class HookFailed extends Error {
  constructor(readonly hook: "namespace" | "context") {
    super(`${hook} request failed`);
  }
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
  // opening one points Mero Standup at a contract that answers none of its
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
  // `error` too, not just the action. These hooks catch a failed request into
  // their `error` state and resolve `null`, so awaiting the action alone cannot
  // tell "the node refused" from "nothing came back": a 500 from `POST
  // /contexts` ("bytecode blob not found") was reported here as "context
  // created but no contextId came back", which is false on both counts.
  const { createNamespace, error: namespaceError } = useCreateNamespace();
  const { createContext, error: contextError } = useCreateContext();

  const [busy, setBusy] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const names = useTeamNames(contexts.map((c) => c.contextId));
  const { mero } = useMero();
  const [failed, setFailed] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // A hook's `error` is state, set by the hook after its action resolved, so
  // it cannot be read inside the async handler that awaited the action: that
  // closure still sees the value from before the call. Record WHICH hook
  // failed and read its error at render time instead, when it is current.
  const failureText =
    failed === null
      ? null
      : failed.kind === "message"
        ? failed.message
        : ((failed.hook === "namespace" ? namespaceError : contextError)?.message ??
          `the ${failed.hook} request failed, but the hook reported no error — is this session connected?`);

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
      if (!namespaceId) throw new HookFailed("namespace");
      await refetchNamespaces();
      setNote(`Namespace ${shortId(namespaceId)} created — now add a context to it.`);
    } catch (e) {
      setFailed(
        e instanceof HookFailed
          ? { kind: "hook", hook: e.hook }
          : { kind: "message", message: e instanceof Error ? e.message : String(e) },
      );
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
      if (!newContextId) throw new HookFailed("context");
      select(newContextId);
    } catch (e) {
      // Surfaced rather than swallowed on purpose: a bare 500 from
      // `POST /contexts` means the contract's `init` rejected the params, and
      // core hides untyped errors deliberately. Hiding it again in the UI
      // leaves nothing to debug.
      setFailed(
        e instanceof HookFailed
          ? { kind: "hook", hook: e.hook }
          : { kind: "message", message: e instanceof Error ? e.message : String(e) },
      );
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
      if (!namespaceId) throw new HookFailed("namespace");
      const ctx = await createContext({ applicationId, groupId: namespaceId });
      const newContextId = (ctx as { contextId?: string } | null)?.contextId;
      if (!newContextId) throw new HookFailed("context");
      // Name it right away. Best effort: an unnamed team still works, and
      // anyone in it can name it later from the top bar.
      if (teamName.trim() && mero) {
        await new StandupClient(mero, newContextId)
          .setTeamName({ name: teamName })
          .catch(() => undefined);
      }
      select(newContextId);
    } catch (e) {
      setFailed(
        e instanceof HookFailed
          ? { kind: "hook", hook: e.hook }
          : { kind: "message", message: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      setBusy(null);
    }
  }

  const nsList = (namespaces ?? []) as unknown[];

  return (
    <>
      <section className="card">
        <h2>Your teams</h2>
        <p className="empty" style={{ marginBottom: 14 }}>
          A team&apos;s standups and decisions live on its members&apos; nodes and
          nowhere else.
        </p>

        {loading && <p className="empty">Loading teams…</p>}
        {error && <pre className="err">{error.message}</pre>}

        {!loading && !applicationId && (
          <p className="empty">
            Waiting for this session to report which application it is bound to —
            until it does, there is no way to tell this app&apos;s teams from
            any other app&apos;s on this node.
          </p>
        )}

        {!loading && applicationId && contexts.length === 0 && (
          <p className="empty">No teams on this node yet. Start one, or join with an invitation.</p>
        )}

        {contexts.length > 0 && (
          <ul className="team-list">
            {contexts.map((c) => (
              <li key={c.contextId}>
                <button className="team-row" onClick={() => select(c.contextId)}>
                  <span className="team-row-name">
                    {names[c.contextId] || <span className="dim">Unnamed team</span>}
                  </span>
                  <span className="mono dim">{shortId(c.contextId)}</span>
                  <span className="team-row-open">Open →</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void makeBoth();
        }}
      >
        <h2>Start a team</h2>
        <div className="row">
          {/*
            Kept as the one-click path: on a fresh node it is the only one
            that can succeed — there is no namespace to add a team to yet.
          */}
          <input
            aria-label="new team name"
            placeholder="Team name, e.g. Platform"
            maxLength={80}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
          <button type="submit" disabled={busy !== null || !applicationId}>
            {busy === "both" ? "Creating…" : "Start a new team"}
          </button>
        </div>
        {note && <p className="empty" style={{ marginTop: 12 }}>{note}</p>}
        {failureText && <pre className="err">{failureText}</pre>}
      </form>

      <section className="card advanced">
        <button
          type="button"
          className="link quiet"
          aria-expanded={advanced}
          onClick={() => setAdvanced((a) => !a)}
        >
          {advanced ? "Hide" : "Show"} advanced: namespaces
        </button>
        {advanced && (
          <>
            <p className="empty" style={{ margin: "10px 0 14px" }}>
              A team (context) lives in a namespace, and a namespace can hold
              several. Members are invited to the <em>namespace</em>, so one
              invitation reaches every team in it.
            </p>

            {nsLoading && <p className="empty">Loading namespaces…</p>}
            {nsError && <pre className="err">{nsError.message}</pre>}

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
                            {busy === id ? "Creating…" : "Add team"}
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
          </>
        )}
      </section>
    </>
  );
}

/**
 * Each listed team's name, read from its own context. Best effort and in
 * parallel: a team whose read fails just shows as unnamed.
 */
function useTeamNames(contextIds: string[]): Record<string, string> {
  const { mero } = useMero();
  const [names, setNames] = useState<Record<string, string>>({});
  const key = contextIds.join(",");
  useEffect(() => {
    if (!mero || !key) return;
    let live = true;
    void Promise.all(
      key.split(",").map(async (id) => {
        try {
          return [id, await new StandupClient(mero, id).teamName()] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setNames(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [mero, key]);
  return names;
}
