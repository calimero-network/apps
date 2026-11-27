import { useEffect, useState } from "react";
import { askAnOwnerCopy, canCreateIn, describeError, orgsWithApp, otherOrgs } from "@calimero-apps/connect";
import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { createWorkspace, createWorkspaceInNewOrg, inviteUrl, listOrgs, listWorkspaces, type OrgRow, type WorkspaceRow } from "./lib/orgs";
import { canDeleteWorkspace, deleteWorkspace, roleName } from "./lib/manage";
import { forgetWorkspaceRecordings } from "./useRecording";
import type { ActiveWorkspace } from "./lib/workspaceStore";
import { APP_PACKAGE, PRODUCT } from "./session";
import { useSignedIn } from "./sessionContext";
import { Icon } from "./ui";

const CREATE_LABELS = {
  title: "Start a workspace",
  subtitle: "Your team's meetings live here. You'll be its owner and can invite people.",
  nameLabel: "Workspace name",
  namePlaceholder: "e.g. Product team",
  selfLabel: "Your name, as your team sees it",
  selfPlaceholder: "e.g. Alex",
};

/** An organization Sylence can be added to: one the account may create apps in. */
interface OrgChoice {
  orgId: string;
  name: string;
  role: string;
  /** What else it holds, in words ("Chat, Docs"), when known. */
  holds: string | null;
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/** A still panel beside the ways in: what Sylence is for, in one line, and a saved meeting drawn under it. */
function PickerShowcase() {
  return (
    <aside className="showcase" aria-label={`Why ${PRODUCT}`}>
      <span className="showcase-eyebrow">Private meeting notes</span>
      <h2 className="showcase-slogan">
        Every word remembered.
        <br />
        Only your team can listen.
      </h2>
      <ul className="showcase-points">
        <li>
          <Icon name="mic" /> Transcribed on your laptop, no bot in the call
        </li>
        <li>
          <Icon name="key" /> Sealed in a secure enclave
        </li>
        <li>
          <Icon name="users" /> Read, search and act on it together
        </li>
      </ul>
      <div className="showcase-card" aria-hidden="true">
        <div className="showcase-card-head">
          <img src="./favicon.svg" alt="" width={16} height={16} />
          <strong>Launch plan</strong>
          <span className="dim">Google Meet · 0:42</span>
          <span className="showcase-seal">
            <Icon name="key" size={11} /> Sealed
          </span>
        </div>
        <p>
          <b className="sc-who amber">Eve</b> Let&apos;s lock the launch plan today.
        </p>
        <p>
          <b className="sc-who blue">John</b> The store listing is ready.
        </p>
        <p className="todo">
          <span className="sc-check" /> Send the deck by Friday
          <b className="sc-who blue">John</b>
        </p>
      </div>
    </aside>
  );
}

/**
 * Choose a workspace, or get one: start a new one (a new organization you
 * own), join a team with an invite link, or add Sylence to an organization
 * you are already in. That last part shows only when there is one to offer.
 */
export function WorkspacePicker({
  onOpen,
  createOnly = false,
}: {
  onOpen: (w: ActiveWorkspace) => void;
  /** Only the ways to get a workspace: the extension asked for a new one. */
  createOnly?: boolean;
}) {
  const { client, accountId, source, passkey, after } = useSignedIn();
  const { source: release, pending: releasePending } = useResolvedSource(client, accountId, source);
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [choices, setChoices] = useState<OrgChoice[] | null>(null);
  /** Some organization holding Sylence is not offered: this account may not add workspaces there. */
  const [someNotAllowed, setSomeNotAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adding, setAdding] = useState<{ orgId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** The workspace whose delete is being confirmed, and whether it is underway. */
  const [deleting, setDeleting] = useState<{ appId: string; busy: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listOrgs(client), listWorkspaces(client, source)])
      .then(async ([o, w]) => {
        if (!live) return;
        setOrgs(o);
        setWorkspaces(w);
        setError(null);
        const [held, others] = await Promise.all([
          orgsWithApp(client, source).catch(() => []),
          otherOrgs(client, source).catch(() => []),
        ]);
        // `null` (cannot tell) keeps the org on offer: the node decides then.
        const may = await Promise.all(held.map((row) => canCreateIn(client, row.orgId)));
        if (!live) return;
        const roleOf = (id: string) => o.find((r) => r.orgId === id)?.role ?? "member";
        const offered: OrgChoice[] = [
          ...held.filter((_, i) => may[i] !== false).map((r) => ({ orgId: r.orgId, name: r.name, role: roleOf(r.orgId), holds: "Sylence" })),
          ...others.map((r) => ({ orgId: r.orgId, name: r.name, role: r.role, holds: r.label || null })),
        ];
        setChoices(offered);
        setSomeNotAllowed(may.some((m) => m === false));
      })
      .catch((e: unknown) => live && setError(describeError(e)))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, source, after, tick]);

  /** A workspace in an organization the account is already in: no consent page. */
  async function addTo(orgId: string, title: string) {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await createWorkspace(client, source, title.trim(), orgId, () => passkey()));
    } catch (e) {
      setError(describeError(e));
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
      after();
    }
  }

  /** The new organization and its name come from the shared dialog, which the node approved. */
  async function created({ orgId, name: title, selfName }: { orgId: string; name: string; selfName: string }) {
    setShowCreate(false);
    setError(null);
    try {
      const made = await createWorkspaceInNewOrg(client, source, title, orgId, () => passkey());
      // Best effort: a member without a name still works.
      await setOrgName(client, orgId, accountId, selfName).catch(() => undefined);
      onOpen(made);
    } catch (e) {
      setError(describeError(e));
      setTick((t) => t + 1);
    } finally {
      after();
    }
  }

  async function remove(appId: string) {
    setDeleting({ appId, busy: true });
    setError(null);
    try {
      await deleteWorkspace(client, appId);
      void forgetWorkspaceRecordings(appId);
      setDeleting(null);
      setTick((t) => t + 1);
    } catch (e) {
      setError(describeError(e));
      setDeleting(null);
    } finally {
      after();
    }
  }

  function join() {
    const url = inviteUrl(link);
    if (!url) {
      setLinkError("That doesn't look like an invite link. It starts with https:// and has invite= in it.");
      return;
    }
    // The page the link opens keeps the invite and asks to join.
    window.location.assign(url.href);
  }

  const orgName = (id: string | null) => orgs?.find((o) => o.orgId === id)?.name ?? (id ? shortId(id) : "");

  return (
    <div className="picker">
      {!createOnly && (
        <header className="page-head">
          <div>
            <h1>Your workspaces</h1>
            <p className="dim">A workspace keeps your team&apos;s meetings and action items. Only its members can read them.</p>
          </div>
        </header>
      )}

      {!createOnly && workspaces === null && !error && <p className="empty">Loading workspaces…</p>}
      {!createOnly && workspaces && workspaces.length > 0 && (
        <ul className="ws-grid">
          {workspaces.map((w) => (
            <li key={w.appId} className="ws-item">
              {deleting?.appId === w.appId ? (
                <div className="ws-card ws-confirm" role="alertdialog" aria-label={`Delete ${w.name || "this workspace"}?`}>
                  <span className="ws-text">
                    <span className="ws-name">Delete {w.name || "this workspace"}?</span>
                    <span className="dim small">Its meetings, recordings and action items go for everyone. This can&apos;t be undone.</span>
                  </span>
                  <span className="row">
                    <button type="button" className="btn small danger" disabled={deleting.busy} onClick={() => void remove(w.appId)}>
                      {deleting.busy ? "Deleting…" : "Delete"}
                    </button>
                    <button type="button" className="btn small ghost" disabled={deleting.busy} onClick={() => setDeleting(null)}>
                      Cancel
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <button type="button" className="ws-card" onClick={() => onOpen({ appId: w.appId, org: w.org })}>
                    <span className="ws-mark" aria-hidden="true">
                      {(w.name || "W").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="ws-text">
                      <span className="ws-name">{w.name || "Unnamed workspace"}</span>
                      <span className="dim">
                        {orgName(w.org)}
                        {w.owner === accountId ? " · Owner" : ""}
                      </span>
                    </span>
                    <Icon name="right" />
                  </button>
                  {canDeleteWorkspace(w, accountId, orgs?.find((o) => o.orgId === w.org)?.role) && (
                    <button
                      type="button"
                      className="icon-btn ws-delete"
                      aria-label={`Delete ${w.name || "workspace"}`}
                      title="Delete workspace"
                      onClick={() => setDeleting({ appId: w.appId, busy: false })}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">{workspaces && workspaces.length > 0 && !createOnly ? "Or get another one" : "Get started"}</h2>
      <div className={createOnly ? "start-layout solo" : "start-layout"}>
      <div className="start-grid">
        <section className="start-card">
          <span className="start-icon">
            <Icon name="plus" size={20} />
          </span>
          <h3 className="start-title">Start a new workspace</h3>
          <p className="dim">For you and your team. You&apos;re the owner, and you invite people when you&apos;re ready.</p>
          <button type="button" className="btn primary" onClick={() => setShowCreate(true)} data-testid="start-workspace">
            Start a workspace
          </button>
        </section>

        <section className="start-card">
          <span className="start-icon">
            <Icon name="link" size={20} />
          </span>
          <h3 className="start-title">Join your team</h3>
          <p className="dim">Got an invite link from a teammate? Paste it here, or just open it.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              aria-label="invite link"
              placeholder="https://…?invite=…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(null);
              }}
            />
            <button type="submit" className="btn" disabled={!link.trim()}>
              Join
            </button>
          </form>
          {linkError && <p className="err small">{linkError}</p>}
        </section>
      </div>
      {!createOnly && (
        <PickerShowcase />
      )}
      </div>

      {choices && choices.length > 0 && (
        <section className="card org-choices">
          <h2>Add {PRODUCT} to an organization you&apos;re in</h2>
          <p className="dim">
            You&apos;re already in these organizations on Calimero. A workspace there is open to their members.
          </p>
          <ul className="org-list">
            {choices.map((c) => (
              <li key={c.orgId} className="org-row">
                <span className="org-icon">
                  <Icon name="building" />
                </span>
                <span className="org-text">
                  <span className="org-name">{c.name || shortId(c.orgId)}</span>
                  <span className="dim small">
                    {roleName(c.role)}
                    {c.holds ? ` · has ${c.holds}` : ""}
                  </span>
                </span>
                {adding?.orgId === c.orgId ? (
                  <form
                    className="row org-add"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addTo(c.orgId, adding.name);
                    }}
                  >
                    <input
                      aria-label="workspace name"
                      autoFocus
                      maxLength={80}
                      placeholder="Workspace name"
                      value={adding.name}
                      onChange={(e) => setAdding({ orgId: c.orgId, name: e.target.value })}
                    />
                    <button type="submit" className="btn small primary" disabled={busy || !adding.name.trim()}>
                      {busy ? "Creating…" : "Create"}
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setAdding(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button type="button" className="btn small" onClick={() => setAdding({ orgId: c.orgId, name: c.name || "" })}>
                    Add workspace
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {someNotAllowed && (
        <p className="dim small" data-testid="workspace-ask-owner">
          Not every organization you&apos;re in is listed. {askAnOwnerCopy("a workspace")}
        </p>
      )}
      {error && <pre className="err">{error}</pre>}

      <CreateWorkspaceDialog
        client={client}
        passkey={passkey()}
        release={releasePending ? null : (reviewRelease(release) ?? { package: APP_PACKAGE })}
        defaultSelfName={lastUsedName()}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={created}
        labels={CREATE_LABELS}
      />
    </div>
  );
}
