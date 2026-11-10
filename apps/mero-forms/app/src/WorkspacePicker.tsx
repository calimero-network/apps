import { useCallback, useEffect, useState } from "react";
import { askAnOwnerCopy, canCreateIn, describeError, orgsWithApp, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { ConnectExistingOrg } from "@calimero-apps/passkey";
import { FormsClient } from "./formsApi";
import { createWorkspace, listOrgs, listWorkspaces, type OrgRow, type WorkspaceRow } from "./lib/orgs";
import type { ActiveWorkspace } from "./lib/workspaceStore";
import { useSignedIn } from "./sessionContext";

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/**
 * Choose which workspace to open, or start one. v1's picker listed the node's
 * contexts and namespaces; on Calimero 1.0 a workspace is an instance of this
 * app in an organization, and the account reaches every instance in every org
 * it is in. Starting a workspace makes an org of the same name and the
 * instance in it, or adds an instance to an org that already holds one. An
 * org made for another app is never offered there: only under "Connect to an
 * existing organization", on the person's explicit choice.
 */
export function WorkspacePicker({ onOpen }: { onOpen: (w: ActiveWorkspace) => void }) {
  const { client, source, passkey, after } = useSignedIn();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  /** The orgs holding a workspace of this app: the only ones the start form offers. */
  const [withApp, setWithApp] = useState<OrgRow[] | null>(null);
  /**
   * Of those, the orgs this account may add a workspace in (core's
   * `CREATE_APP`): an owner or admin, or a member allowed to. The others are
   * not offered, since a create there fails; `null` until known.
   */
  const [creatable, setCreatable] = useState<OrgRow[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [org, setOrg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([listOrgs(client), listWorkspaces(client, source), orgsWithApp(client, source)])
      .then(async ([o, w, held]) => {
        if (!live) return;
        setOrgs(o);
        setWorkspaces(w);
        setWithApp(held);
        setError(null);
        // `null` (cannot tell) keeps the org on offer: the node decides then.
        const may = await Promise.all(held.map((row) => canCreateIn(client, row.orgId)));
        if (live) setCreatable(held.filter((_, i) => may[i] !== false));
      })
      .catch((e: unknown) => live && setError(describeError(e)))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, source, after, tick]);

  async function start() {
    const title = name.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createWorkspace(client, source, title, org || null, () => passkey());
      // Name it right away. Best effort: an unnamed workspace still works.
      await new FormsClient(client, made.appId, after).setWorkspaceName({ name: title }).catch(() => undefined);
      onOpen(made);
    } catch (e) {
      setError(describeError(e));
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
      after();
    }
  }

  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);

  /** "Connect to an existing organization": a workspace in that org, named after it. */
  async function connect(target: OtherOrg) {
    const title = name.trim() || target.name || "Workspace";
    try {
      const made = await createWorkspace(client, source, title, target.orgId, () => passkey());
      await new FormsClient(client, made.appId, after).setWorkspaceName({ name: title }).catch(() => undefined);
      onOpen(made);
    } finally {
      after();
    }
  }

  const orgName = (id: string | null) => orgs?.find((o) => o.orgId === id)?.name ?? (id ? shortId(id) : "");

  return (
    <>
      <section className="card">
        <h2>Your workspaces</h2>
        <p className="empty" style={{ marginBottom: 14 }}>
          A workspace&apos;s forms and responses are reached only by the members of its
          organization, and read only by its team.
        </p>
        {workspaces === null && !error && <p className="empty">Loading workspaces…</p>}
        {workspaces !== null && workspaces.length === 0 && (
          <p className="empty">No workspaces yet. Start one, or open an invitation link someone sent you.</p>
        )}
        {workspaces && workspaces.length > 0 && (
          <ul className="team-list">
            {workspaces.map((w) => (
              <li key={w.appId}>
                <button className="team-row" onClick={() => onOpen({ appId: w.appId, org: w.org })}>
                  <span className="team-row-name">{w.name || <span className="dim">Unnamed workspace</span>}</span>
                  <span className="mono dim">{orgName(w.org)}</span>
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
          void start();
        }}
      >
        <h2>Start a workspace</h2>
        <div className="row">
          <input
            aria-label="new workspace name"
            placeholder="Workspace name, e.g. Marketing"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {creatable && creatable.length > 0 && (
            <select aria-label="organization" value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="">In a new organization</option>
              {creatable.map((o) => (
                <option key={o.orgId} value={o.orgId}>
                  In {o.name || shortId(o.orgId)}
                </option>
              ))}
            </select>
          )}
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Start a new workspace"}
          </button>
        </div>
        {withApp && creatable && creatable.length < withApp.length && (
          <p className="empty" data-testid="workspace-ask-owner">
            Not every organization you are in is listed. {askAnOwnerCopy("a workspace")}
          </p>
        )}
        {error && <pre className="err">{error}</pre>}
        <ConnectExistingOrg appName="Mero Forms" load={loadOtherOrgs} onConnect={connect} />
      </form>
    </>
  );
}
