import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { useSelfAccount } from "../lib/forum";
import {
  createSpaceNamespace,
  deleteSpace,
  leaveSpace,
  listSpaceNamespaces,
  mintNamespaceInvite,
  selfIsGroupAdmin,
  type NamespaceRow,
} from "../lib/groups";
import InviteModal from "../components/InviteModal";
import { useDialogOpen } from "../hooks/useDialogOpen";
import {
  AccountChip,
  Avatar,
  NavItem,
  Shell,
  SideCard,
} from "../components/chrome";
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

/** Focus the create field from the rail's call to action. Presentation only. */
function focusCreate() {
  const el = document.getElementById("space-name");
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
}

/**
 * Spaces = NAMESPACES. One level up from where this page used to sit.
 *
 * It used to list contexts and name each one a "space", which collapsed two
 * distinct things into one and left no forum for forums: creating a space made a
 * namespace plus a context and nothing could ever add a second forum to it. The
 * model that actually matches Calimero, and what the two-node suite proves:
 *
 *   Namespace ("space")  ← you invite people HERE
 *     └── Subgroup ("forum") + Context   ← one board   → /spaces/:id
 *
 * So: this page creates namespaces and invites to namespaces. Forums live on
 * ForumsPage. Joining is not done here: an invitation reaches the app only as
 * an opened link, and the app-level `InvitationPrompt` takes it from there.
 */
export default function SpacesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mero, logout, nodeUrl } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();
  const nodeLabel = (() => {
    if (!nodeUrl) return "";
    try {
      const u = new URL(nodeUrl);
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return nodeUrl;
    }
  })();

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  // Whether this account is an Admin of each space, by id. An Admin deletes a
  // space; anyone else leaves it. Absent while unknown: the menu then offers
  // neither rather than guessing.
  const selfAccount = useSelfAccount();
  const [adminOf, setAdminOf] = useState<Record<string, boolean>>({});
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");

  // One key names the action in flight ("create", `invite:<id>`), instead of a
  // single `busy` boolean. With a boolean, clicking Invite disabled Create and
  // every row, and all of them read "Working…" — indistinguishable from
  // the page having locked up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string } | null>(
    null,
  );
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(null);
        setStatus(null);
      }
    },
    [],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (!mero || !appId) {
        setListing(false);
        return;
      }
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listSpaceNamespaces(mero.admin, appId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load spaces.");
      } finally {
        setListing(false);
      }
    },
    [mero, appId],
  );

  // Keyed on the navigation too. Accepting an invitation whose space cannot be
  // placed yet lands on `/spaces` — possibly this page, which React Router does
  // not remount — so without the key the joined space would be missing from
  // the list until a full reload.
  useEffect(() => {
    void load();
  }, [load, location.key]);

  const spaceIds = namespaces.map((n) => n.namespaceId).join(",");
  useEffect(() => {
    const ids = spaceIds ? spaceIds.split(",") : [];
    if (!mero || !selfAccount || ids.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ids.map(
        async (id) =>
          [id, await selfIsGroupAdmin(mero.admin, id, selfAccount)] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setAdminOf(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [mero, selfAccount, spaceIds]);

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

  const create = useCallback(() => {
    const spaceName = name.trim();
    if (!spaceName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Forum from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { namespaceId } = await createSpaceNamespace(
        mero.admin,
        { applicationId: appId, name: spaceName },
        onStatus,
      );
      setName("");
      onStatus("Refreshing your spaces…");
      await load(false);
      // Straight into the new namespace: it has no forums yet, and making one is
      // the only useful next step.
      navigate(`/spaces/${namespaceId}`);
    });
  }, [name, mero, appId, run, load, navigate]);

  const mintInvite = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      void run(`invite:${ns.namespaceId}`, async (onStatus) => {
        const code = await mintNamespaceInvite(
          mero.admin,
          { namespaceId: ns.namespaceId, namespaceName: ns.name },
          onStatus,
        );
        setInvite({ id: ns.namespaceId, code });
        showToast(`Invite ready for “${ns.name}”.`);
      });
    },
    [mero, run, showToast],
  );

  const removeSpace = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      setPendingDelete(null);
      void run(`delete:${ns.namespaceId}`, async (onStatus) => {
        await deleteSpace(
          mero.admin,
          { namespaceId: ns.namespaceId },
          onStatus,
        );
        onStatus("Refreshing your spaces…");
        await load(false);
        showToast(`Deleted \u201c${ns.name}\u201d.`);
      });
    },
    [mero, run, load, showToast],
  );

  const exitSpace = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      void run(`leave:${ns.namespaceId}`, async (onStatus) => {
        await leaveSpace(mero.admin, { namespaceId: ns.namespaceId }, onStatus);
        onStatus("Refreshing your spaces…");
        await load(false);
        showToast(`Left \u201c${ns.name}\u201d.`);
      });
    },
    [mero, run, load, showToast],
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
            onClick={focusCreate}
            aria-label="New space"
          >
            <span className="x-ctaIcon">
              <PlusIcon size={22} />
            </span>
            <span className="x-ctaLabel">New space</span>
          </button>
        }
        account={
          <AccountChip
            host={nodeLabel || null}
            hostTitle={nodeUrl ?? undefined}
            onLogout={logout}
          />
        }
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
                    <strong>Peer to peer</strong>
                    Everything lives on members' nodes — no central server.
                  </span>
                </li>
              </ul>
            </SideCard>
          </>
        }
      >
        <div className={styles.createRow}>
          <Avatar label="+" seed="space" square icon={<PlusIcon size={20} />} />
          <input
            id="space-name"
            className={styles.createInput}
            placeholder="Name a new space…"
            aria-label="New space name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="space-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <button
            className="ui-btn ui-btn-primary"
            onClick={create}
            disabled={pending === "create" || !name.trim() || !appId}
            data-testid="create-space"
          >
            {pending === "create" && <span className="ui-spinner" />}
            {pending === "create" ? "Creating…" : "Create"}
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

        {notInstalled && (
          <p className={`${styles.note} ${styles.noteWarn}`}>
            <AlertIcon size={16} />
            Mero Forum is not installed on this node. Install it from the
            marketplace, then reload — spaces are listed per application.
          </p>
        )}

        {listing || resolvingAppId ? (
          <div aria-label="Loading…">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : namespaces.length === 0 ? (
          !notInstalled && (
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
                onClick={focusCreate}
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
                    {adminOf[ns.namespaceId] === true && (
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
                    {adminOf[ns.namespaceId] === false && (
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
          happens for everyone in the space, not just on this node, and it
          cannot be undone.
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

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={`Whole space · ${namespaces.find((n) => n.namespaceId === invite?.id)?.name ?? ""}`}
        onClose={() => setInvite(null)}
      />
    </>
  );
}
