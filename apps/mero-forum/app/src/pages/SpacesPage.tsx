import { useCallback, useEffect, useRef, useState } from "react";
import { appInviteTeams, appOnlyInviteNote, describeError, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { CreateWorkspaceDialog, InviteDialog } from "@calimero-network/mero-react";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { ConnectExistingOrg, reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_PACKAGE } from "../config";
import { useToast } from "../contexts/ToastContext";
import { useSignedIn } from "../sessionContext";
import {
  CONNECTED_FORUM_NAME,
  createForum,
  finishSpace,
  deleteSpace,
  inviteLinkBase,
  isSpaceAdmin,
  leaveSpace,
  leaveSpaceOrg,
  PRODUCT_NAME,
  listSpaces,
  type NamespaceRow,
} from "../lib/spaces";
import SessionMenu from "../components/SessionMenu";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { Avatar, NavItem, Shell, SideCard } from "../components/chrome";
import {
  AlertIcon,
  CopyIcon,
  HashIcon,
  LayersIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "../components/icons";
import styles from "./Picker.module.css";

const INVITE_LABELS = {
  noun: "space",
  title: "Invite people to this space",
  subtitle: "They can read every forum inside it. Choose what they can do.",
};

const CREATE_LABELS = {
  title: "New space",
  subtitle: "Name your space. Its forums are reachable by its members only.",
  nameLabel: "Space name",
  namePlaceholder: "e.g. Design guild",
  selfLabel: "Your name in this space",
  selfPlaceholder: "e.g. Ana",
};

/**
 * Spaces = ORGANIZATIONS (v1: namespaces).
 *
 *   Organization ("space")  ← you invite people HERE
 *     └── App instance ("forum")   ← one board   → /spaces/:id
 *
 * So: this page creates orgs and invites to orgs. Forums live on ForumsPage.
 * Joining is not done here: an invitation reaches the app only as an opened
 * link, and the app-level `InvitationPrompt` takes it from there.
 */
export default function SpacesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { client, accountId, source, passkey, after } = useSignedIn();
  const { source: release, pending: releasePending } = useResolvedSource(client, accountId, source);
  const { showToast } = useToast();

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  const [listing, setListing] = useState(true);
  // The last list failed. An empty list then is not "no spaces": offering a
  // create would found a duplicate of a space you have.
  const [listFailed, setListFailed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // One key names the action in flight ("create", `invite:<id>`), instead of a
  // single `busy` boolean. With a boolean, clicking Invite disabled Create and
  // every row, and all of them read "Working…" — indistinguishable from
  // the page having locked up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ org: string; teams: string[]; appOnly: boolean } | null>(null);
  // The space pending deletion. A confirm step rather than `confirm()`, because
  // this takes every forum in the space with it and the sentence has to say so.
  // Which card's menu is open. mero-design keys this by id and closes on an
  // outside click via a ref on the OPEN card only — same shape here.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NamespaceRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  /**
   * Run one action under its own key, with step status wired to `onStatus`.
   * Clears the previous outcome first: leaving a stale "Joined ✓" above a fresh
   * spinner reads as if the new action had already finished.
   */
  const run = useCallback(
    async (
      key: string,
      fn: (onStatus: (m: string) => void) => Promise<void>,
    ) => {
      setPending(key);
      setError(null);
      setStatus(null);
      try {
        await fn(setStatus);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setPending(null);
        setStatus(null);
        after();
      }
    },
    [after],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listSpaces(client, source));
        setListFailed(false);
      } catch (e) {
        setListFailed(true);
        setError(describeError(e));
      } finally {
        setListing(false);
        after();
      }
    },
    [client, source, after],
  );

  // Keyed on the navigation too. Accepting an invitation lands on `/spaces`
  // (or a space) — possibly this page, which React Router does not remount —
  // so without the key the joined space would be missing until a reload.
  useEffect(() => {
    void load();
  }, [load, location.key]);

  // Close an open card menu on an outside click. The ref is attached to the
  // OPEN card only (see the grid below), so this compares against one node
  // rather than tracking every card.
  useEffect(() => {
    if (!menuOpenId) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpenId]);

  const created = useCallback(
    ({ orgId, selfName }: { orgId: string; name: string; selfName: string }) => {
      setShowCreate(false);
      void run("create", async (onStatus) => {
        const { namespaceId, warning } = await finishSpace(client, orgId, passkey, source);
        if (warning) showToast(warning, "error");
        // Best effort: without it the first post asks for a name.
        await setOrgName(client, orgId, accountId, selfName).catch(() => undefined);
        onStatus("Refreshing your spaces…");
        await load(false);
        // Straight into the new space: it has no forums yet, and making one is
        // the only useful next step.
        navigate(`/spaces/${namespaceId}`);
      });
    },
    [client, accountId, passkey, source, run, load, navigate, showToast],
  );

  // "Connect to an existing organization": forums go into an org the account
  // has for another app only on this explicit choice, with a first forum.
  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      try {
        await createForum(client, source, org.orgId, CONNECTED_FORUM_NAME, passkey);
      } finally {
        after();
      }
      await load(false);
      navigate(`/spaces/${org.orgId}`);
    },
    [client, source, passkey, after, load, navigate],
  );

  const mintInvite = useCallback(
    (ns: NamespaceRow) => {
      void run(`invite:${ns.namespaceId}`, async () => {
        const { teams, appOnly } = await appInviteTeams(client, ns.namespaceId, source);
        setInvite({ org: ns.namespaceId, teams, appOnly });
      });
    },
    [client, source, run],
  );

  const removeSpace = useCallback(
    (ns: NamespaceRow) => {
      setPendingDelete(null);
      void run(`delete:${ns.namespaceId}`, async (onStatus) => {
        onStatus("Approve the deletion with your passkey…");
        await deleteSpace(client, ns.namespaceId, passkey);
        onStatus("Refreshing your spaces…");
        await load(false);
        showToast(`Deleted \u201c${ns.name}\u201d.`);
      });
    },
    [client, passkey, run, load, showToast],
  );

  const exitSpace = useCallback(
    (ns: NamespaceRow) => {
      void run(`leave:${ns.namespaceId}`, async (onStatus) => {
        onStatus("Approve leaving with your passkey…");
        const left = await leaveSpace(client, ns.namespaceId, source, passkey);
        // An org that keeps its apps apart: Mero Forum only. When it was the
        // last app there, the organization itself is offered too.
        if (
          left.left === "app" &&
          left.lastApp &&
          window.confirm(`${PRODUCT_NAME} was your last app in this organization. Leave the organization too?`)
        ) {
          onStatus("Approve leaving the organization with your passkey…");
          await leaveSpaceOrg(client, ns.namespaceId, passkey);
        }
        onStatus("Refreshing your spaces…");
        await load(false);
        showToast(`Left \u201c${ns.name}\u201d.`);
      });
    },
    [client, source, passkey, run, load, showToast],
  );

  useDialogOpen(deleteDialogRef, !!pendingDelete);

  return (
    <>
      <Shell
        nav={<NavItem icon={<LayersIcon size={24} />} label="Spaces" active />}
        cta={
          <button
            type="button"
            className="ui-btn ui-btn-primary x-ctaBtn"
            onClick={() => setShowCreate(true)}
            aria-label="New space"
          >
            <span className="x-ctaIcon">
              <PlusIcon size={22} />
            </span>
            <span className="x-ctaLabel">New space</span>
          </button>
        }
        account={<SessionMenu />}
        header={
          <div className="x-headRow">
            <div className="x-headText">
              <h1 className="x-headTitle">Your Spaces</h1>
              <span className="x-headSub">
                Spaces hold forums and the people invited to them
              </span>
            </div>
          </div>
        }
        aside={
          <>
            <SideCard title="How it works">
              <ul className={styles.howList}>
                <li className={styles.howItem}>
                  <span className={styles.howTile}>
                    <LayersIcon size={16} />
                  </span>
                  <span>
                    <strong>Spaces</strong>
                    Invite people once; they can read every forum inside.
                  </span>
                </li>
                <li className={styles.howItem}>
                  <span className={styles.howTile}>
                    <HashIcon size={16} />
                  </span>
                  <span>
                    <strong>Forums</strong>
                    Each forum is its own board of posts and replies.
                  </span>
                </li>
                <li className={styles.howItem}>
                  <span className={styles.howTile}>
                    <UsersIcon size={16} />
                  </span>
                  <span>
                    <strong>Members only</strong>
                    A space&apos;s forums are reachable by its members, nobody else.
                  </span>
                </li>
              </ul>
            </SideCard>
          </>
        }
      >
        <div className={styles.createRow}>
          <Avatar label="+" seed="space" square icon={<PlusIcon size={20} />} />
          <span className={styles.createLabel}>Name a new space</span>
          <button
            className="ui-btn ui-btn-primary"
            onClick={() => setShowCreate(true)}
            disabled={pending === "create"}
            data-testid="create-space"
          >
            {pending === "create" && <span className="ui-spinner" />}
            {pending === "create" ? "Creating…" : "New space"}
          </button>
        </div>

        {status && (
          <p className={styles.note} role="status">
            <span className="ui-spinner" />
            {status}
          </p>
        )}
        {error && (
          <p className={`${styles.note} ${styles.noteError}`} role="alert">
            <AlertIcon size={16} />
            {error}
          </p>
        )}

        <div style={{ margin: "8px 0 16px" }}>
          <ConnectExistingOrg appName="Mero Forum" load={loadOtherOrgs} onConnect={connectOrg} />
        </div>

        {listing ? (
          <div aria-label="Loading…">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : namespaces.length === 0 && listFailed ? (
          <div className={styles.empty} data-testid="spaces-list-failed">
            <span className={styles.emptyTitle}>
              Your spaces could not be loaded
            </span>
            Try again before creating one, so you do not end up with a second
            copy of a space you have.
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => void load()}
              data-testid="spaces-retry"
            >
              Try again
            </button>
          </div>
        ) : namespaces.length === 0 ? (
          (
            <div className={styles.empty} data-testid="spaces-empty">
              <Avatar
                label="S"
                seed="space"
                square
                size={56}
                icon={<LayersIcon size={26} />}
              />
              <span className={styles.emptyTitle}>No spaces yet</span>
              Create one above, or open an invitation link someone sent you.
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                style={{ marginTop: 14 }}
                onClick={() => setShowCreate(true)}
              >
                <PlusIcon size={16} />
                New space
              </button>
            </div>
          )
        ) : (
          <div className={styles.list}>
            {namespaces.map((ns) => (
              <div
                key={ns.namespaceId}
                className={styles.row}
                ref={menuOpenId === ns.namespaceId ? menuRef : null}
              >
                <button
                  className={styles.rowMain}
                  data-testid="space-row"
                  onClick={() => navigate(`/spaces/${ns.namespaceId}`)}
                >
                  <Avatar
                    label={ns.name}
                    seed={ns.namespaceId}
                    square
                    size={44}
                  />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{ns.name}</span>
                    <span className={styles.rowMeta}>
                      <span className={styles.metaItem}>
                        <HashIcon size={14} />
                        {ns.forumCount} forum{ns.forumCount === 1 ? "" : "s"}
                      </span>
                      <span className={styles.metaItem}>
                        <UsersIcon size={14} />
                        {ns.memberCount} member{ns.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                  <span className={styles.pill}>Open</span>
                </button>
                <div className={styles.menuCell}>
                  <button
                    className="ui-iconBtn"
                    data-testid="space-menu"
                    title="More options"
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === ns.namespaceId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(
                        menuOpenId === ns.namespaceId ? null : ns.namespaceId,
                      );
                    }}
                  >
                    <MoreIcon size={18} />
                  </button>
                </div>
                {menuOpenId === ns.namespaceId && (
                  <div className={styles.dropdown} role="menu">
                    <button
                      className="ui-menuItem"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpenId(null);
                        mintInvite(ns);
                      }}
                      data-testid="invite-btn"
                    >
                      <UserPlusIcon size={17} />
                      Invite
                    </button>
                    <button
                      className="ui-menuItem"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpenId(null);
                        void navigator.clipboard
                          ?.writeText(ns.namespaceId)
                          .then(() => showToast("Space ID copied."))
                          .catch(() => undefined);
                      }}
                    >
                      <CopyIcon size={17} />
                      Copy space ID
                    </button>
                    {isSpaceAdmin(ns.role) && (
                      <button
                        className="ui-menuItem"
                        role="menuitem"
                        data-danger="true"
                        onClick={() => {
                          setMenuOpenId(null);
                          setPendingDelete(ns);
                        }}
                        data-testid="delete-space"
                      >
                        <TrashIcon size={17} />
                        Delete
                      </button>
                    )}
                    {!isSpaceAdmin(ns.role) && (
                      <button
                        className="ui-menuItem"
                        role="menuitem"
                        data-danger="true"
                        onClick={() => {
                          setMenuOpenId(null);
                          exitSpace(ns);
                        }}
                        data-testid="leave-space"
                      >
                        <LogOutIcon size={17} />
                        Leave
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Shell>

      {/* A confirm step rather than `window.confirm`: deleting a space deletes
          every forum in it, for everyone, and a native dialog has no room to
          say so. */}
      <dialog
        ref={deleteDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingDelete(null)}
      >
        <h2 className={styles.confirmTitle}>Delete this space?</h2>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and the{" "}
          <strong>
            {pendingDelete?.forumCount ?? 0} forum
            {pendingDelete?.forumCount === 1 ? "" : "s"}
          </strong>{" "}
          inside it will be deleted, with every post and comment in them. This
          happens for everyone in the space, and it cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <button
            className="ui-btn ui-btn-dangerSolid"
            onClick={() => pendingDelete && removeSpace(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.namespaceId}`}
            data-testid="confirm-delete-space"
          >
            Delete
          </button>
          <button className="ui-btn" onClick={() => setPendingDelete(null)}>
            Cancel
          </button>
        </div>
      </dialog>

      {invite && (
        <InviteDialog
          client={client}
          passkey={passkey()}
          open
          onClose={() => setInvite(null)}
          org={invite.org}
          teams={invite.teams}
          appName={PRODUCT_NAME}
          labels={invite.appOnly ? { ...INVITE_LABELS, note: appOnlyInviteNote(PRODUCT_NAME) } : INVITE_LABELS}
          linkBase={inviteLinkBase(invite.org)}
        />
      )}

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
    </>
  );
}
