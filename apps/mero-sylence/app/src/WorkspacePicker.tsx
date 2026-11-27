import { useEffect, useRef, useState, type CSSProperties } from "react";
import { describeError } from "@calimero-apps/connect";
import { CreateWorkspaceDialog } from "@calimero-network/mero-react";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { createWorkspaceInNewOrg, inviteUrl, listOrgs, listWorkspaces, type OrgRow, type WorkspaceRow } from "./lib/orgs";
import { canDeleteWorkspace, deleteWorkspace, roleName } from "./lib/manage";
import { avatarHue } from "./lib/people";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { forgetWorkspaceRecordings } from "./useRecording";
import type { ActiveWorkspace } from "./lib/workspaceStore";
import { APP_PACKAGE, PRODUCT } from "./session";
import { useSignedIn } from "./sessionContext";
import { Icon } from "./ui";
import { usePresence } from "./usePresence";

const CREATE_LABELS = {
  title: "Start a workspace",
  subtitle: "Your team's meetings live here. You'll be its owner and can invite people.",
  nameLabel: "Workspace name",
  namePlaceholder: "e.g. Product team",
  selfLabel: "Your name, as your team sees it",
  selfPlaceholder: "e.g. Alex",
};

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

/** One workspace: its own colour, name and your role; open it, or delete it from the "⋯" menu. */
function WorkspaceCard({
  workspace: w,
  orgName,
  role,
  canDelete,
  onOpen,
  onDelete,
}: {
  workspace: WorkspaceRow;
  orgName: string;
  role: string;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuPresence = usePresence(menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  const name = w.name || "Unnamed workspace";
  // The org is worth naming only when it is not just the workspace's own name.
  const org = orgName && orgName !== w.name ? orgName : null;
  return (
    <li className="ws-item" style={{ "--ws-hue": avatarHue(w.appId) } as CSSProperties}>
      <button type="button" className="ws-card" onClick={onOpen}>
        <span className="ws-mark" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="ws-text">
          <span className="ws-name">{name}</span>
          <span className="ws-meta">
            <span className={`ws-role ${role}`}>{roleName(role)}</span>
            {org && <span className="dim small">in {org}</span>}
          </span>
        </span>
      </button>
      {canDelete && (
        <div className="ws-more" ref={ref}>
          <button
            type="button"
            className="icon-btn"
            aria-label={`More for ${name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <Icon name="more" />
          </button>
          {menuPresence.mounted && (
            <div className={`menu-panel glass-float ws-more-panel${menuPresence.closing ? " closing" : ""}`} role="menu">
              <button
                role="menuitem"
                className="menu-item danger-text"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                <Icon name="trash" /> Delete workspace
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Choose a workspace, or get one: start a new one (a new organization you
 * own), or join a team with an invite link.
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
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** The workspace whose delete is being confirmed, and whether it is underway. */
  const [deleting, setDeleting] = useState<{ appId: string; name: string; busy: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listOrgs(client), listWorkspaces(client, source)])
      .then(([o, w]) => {
        if (!live) return;
        setOrgs(o);
        setWorkspaces(w);
        setError(null);
      })
      .catch((e: unknown) => live && setError(describeError(e)))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, source, after, tick]);

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

  async function remove() {
    if (!deleting) return;
    const { appId } = deleting;
    setDeleting({ ...deleting, busy: true });
    setDeleteError(null);
    try {
      await deleteWorkspace(client, appId);
      void forgetWorkspaceRecordings(appId);
      setDeleting(null);
      setTick((t) => t + 1);
    } catch (e) {
      setDeleteError(describeError(e));
      setDeleting((d) => (d ? { ...d, busy: false } : d));
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
            <WorkspaceCard
              key={w.appId}
              workspace={w}
              orgName={orgName(w.org)}
              role={w.owner === accountId ? "owner" : (orgs?.find((o) => o.orgId === w.org)?.role ?? "member")}
              canDelete={canDeleteWorkspace(w, accountId, orgs?.find((o) => o.orgId === w.org)?.role)}
              onOpen={() => onOpen({ appId: w.appId, org: w.org })}
              onDelete={() => {
                setDeleteError(null);
                setDeleting({ appId: w.appId, name: w.name, busy: false });
              }}
            />
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

      {error && <pre className="err">{error}</pre>}

      <DeleteWorkspaceDialog
        name={deleting?.name ?? ""}
        open={deleting !== null}
        busy={deleting?.busy ?? false}
        error={deleteError}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
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
