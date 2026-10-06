import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveForum, setForumName } from "../lib/session";
import {
  createForum,
  deleteForum,
  enterForumContext,
  listForums,
  mintNamespaceInvite,
  mintForumInvite,
  type ForumRow,
} from "../lib/groups";
import InviteModal from "../components/InviteModal";
import { useDialogOpen } from "../hooks/useDialogOpen";
import {
  AccountChip,
  Avatar,
  NavItem,
  Shell,
  SideCard,
  TechDetails,
} from "../components/chrome";
import {
  AlertIcon,
  CopyIcon,
  HashIcon,
  LayersIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "../components/icons";
import styles from "./Picker.module.css";

/** Focus the create field from the rail's call to action. Presentation only. */
function focusCreate() {
  const el = document.getElementById("forum-name");
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
}
import { JoinSyncBanner, useJoinSync } from "@calimero-apps/join-sync";

/**
 * Forums inside one space (namespace). A forum is a SUBGROUP plus the context bound
 * to it, and that context is the board.
 *
 * The two things this page exists to make possible, both proven by suite S3/S4:
 *
 *   - A namespace can hold MORE THAN ONE forum. The old picker created a namespace
 *     and a single context together, so it could not.
 *   - A forum is joinable by someone who only holds the namespace, because it is
 *     created OPEN. Restricted is the default, and a restricted forum answers
 *     `join-via-inheritance` with 403 — invited members could see the space and
 *     never reach the forum.
 *
 * Two invite scopes are offered, and the difference is DESTINATION, not grant:
 * both codes join the space (forum access is inherited from it, so there is no
 * narrower grant to hand out — see `mintForumInvite`), but a forum code drops the
 * joiner straight into that forum while a space code leaves them on this list. The
 * hints say so rather than implying the forum code is more restrictive.
 */
export default function ForumsPage() {
  const navigate = useNavigate();
  const { namespaceId = "" } = useParams();
  const { mero, logout, nodeUrl } = useMero();
  const nodeLabel = (() => {
    if (!nodeUrl) return "";
    try {
      const u = new URL(nodeUrl);
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return nodeUrl;
    }
  })();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId } = useApplicationId();

  const [forums, setForums] = useState<ForumRow[]>([]);
  /** The space whose forum list has come back at least once. */
  const [listedForNs, setListedForNs] = useState<string | null>(null);
  /** Contract roster per forum context, kept for the member counts on each row. */
  const [listing, setListing] = useState(true);
  const [nsName, setNsName] = useState("");
  const [name, setName] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    key: string;
    code: string;
    scope: string;
    hint: React.ReactNode;
  } | null>(null);
  // The forum pending deletion. Its posts and comments go with it, for
  // everyone — a sentence `window.confirm` has no room for.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ForumRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

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
      if (!mero || !namespaceId) return;
      if (showSpinner) setListing(true);
      try {
        // The namespace's own name for the header, so the page says which space
        // you are in rather than a truncated id.
        const info = await mero.admin
          .getNamespace(namespaceId)
          .catch(() => null);
        setNsName(
          (info?.name ?? "").trim() || `Space ${namespaceId.slice(0, 6)}`,
        );
        setForums(await listForums(mero.admin, namespaceId));
        // A real answer, empty or not — that is what ends the sync gate.
        setListedForNs(namespaceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load forums.");
      } finally {
        setListing(false);
      }
    },
    [mero, namespaceId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A space joined this session whose forums have not replicated yet. Without
  // this the branch below tells a brand-new member "No forums yet. Create one
  // above." about a space that may be full of them.
  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: namespaceId || null,
    settled: listedForNs === namespaceId,
  });

  const create = useCallback(() => {
    const forumName = name.trim();
    if (!forumName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Forum from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { contextId, memberPublicKey } = await createForum(
        mero.admin,
        { applicationId: appId, namespaceId, name: forumName },
        onStatus,
      );
      setForumName(contextId, forumName);
      setName("");
      setActiveForum(contextId, memberPublicKey, namespaceId);
      // Into the forum: the creator is already a member, so there is nothing to wait
      // for. 480p H.264 (/live), not the 64x48 in-WASM comparison route.
      navigate("/f");
    });
  }, [name, mero, appId, namespaceId, run, navigate]);

  /** Enter a forum: join it if needed, wait for the identity, then open the forum. */
  const enter = useCallback(
    (forum: ForumRow) => {
      if (!mero) return;
      if (!forum.contextId) {
        setError(
          `“${forum.name}” has no forum context on this node yet. It may still be replicating — refresh in a moment.`,
        );
        return;
      }
      const contextId = forum.contextId;
      void run(`enter:${forum.forumId}`, async (onStatus) => {
        const identity = await enterForumContext(
          mero.admin,
          { forumId: forum.forumId, contextId },
          onStatus,
        );
        setForumName(contextId, forum.name);
        setActiveForum(contextId, identity, namespaceId);
        navigate("/f");
      });
    },
    [mero, run, navigate, namespaceId],
  );

  const inviteToForum = useCallback(
    (forum: ForumRow) => {
      if (!mero) return;
      void run(`invite:${forum.forumId}`, async (onStatus) => {
        const code = await mintForumInvite(
          mero.admin,
          {
            namespaceId,
            forumId: forum.forumId,
            forumName: forum.name,
            namespaceName: nsName,
            contextId: forum.contextId,
          },
          onStatus,
        );
        setInvite({
          key: `forum:${forum.forumId}`,
          code,
          scope: `Opens ${forum.name}`,
          hint: (
            <>
              One paste puts them straight into <strong>{forum.name}</strong>.
              Note what it grants: joining <strong>{nsName}</strong>, which is
              what makes any forum in it reachable — forum access is inherited
              from the space, so this is <em>not</em> narrower than the space
              code. It just lands them in this forum instead of the forum list.
            </>
          ),
        });
        showToast(`Invite ready for “${forum.name}”.`);
      });
    },
    [mero, namespaceId, nsName, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    if (!mero) return;
    void run("invite:namespace", async (onStatus) => {
      const code = await mintNamespaceInvite(
        mero.admin,
        { namespaceId, namespaceName: nsName },
        onStatus,
      );
      setInvite({
        key: "namespace",
        code,
        scope: `Whole space · ${nsName}`,
        hint: (
          <>
            This code joins <strong>{nsName}</strong> and every forum in it,
            including forums made later. It lands them on the forum list — to
            drop someone directly into one forum, use <strong>Invite</strong> on
            that forum.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [mero, namespaceId, nsName, run, showToast]);

  useDialogOpen(deleteDialogRef, !!pendingDelete);

  useEffect(() => {
    if (!menuOpenId) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpenId]);

  const removeForum = useCallback(
    (forum: ForumRow) => {
      if (!mero) return;
      setPendingDelete(null);
      void run(`delete:${forum.forumId}`, async (onStatus) => {
        await deleteForum(
          mero.admin,
          { forumId: forum.forumId, contextId: forum.contextId },
          onStatus,
        );
        onStatus("Refreshing forums…");
        await load(false);
        showToast(`Deleted \u201c${forum.name}\u201d.`);
      });
    },
    [mero, run, load, showToast],
  );

  const spaceName = nsName || "Space";
  const joinedCount = forums.filter((f) => f.joined).length;

  return (
    <>
      <Shell
        nav={
          <>
            <NavItem
              icon={<LayersIcon size={24} />}
              label="Spaces"
              onClick={() => navigate("/spaces")}
            />
            <NavItem icon={<HashIcon size={24} />} label="Forums" active />
            <NavItem
              icon={<UserPlusIcon size={24} />}
              label={pending === "invite-ns" ? "Inviting…" : "Invite people"}
              onClick={inviteToNamespace}
              disabled={pending === "invite-ns"}
              testId="invite-space"
            />
          </>
        }
        cta={
          <button
            type="button"
            className="ui-btn ui-btn-primary x-ctaBtn"
            onClick={focusCreate}
            aria-label="New forum"
          >
            <span className="x-ctaIcon">
              <PlusIcon size={22} />
            </span>
            <span className="x-ctaLabel">New forum</span>
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
              <h1 className="x-headTitle">Forums</h1>
              <span className="x-headSub">
                <LayersIcon size={13} />
                {spaceName}
              </span>
            </div>
          </div>
        }
        aside={
          <>
            <SideCard>
              <div className={styles.aboutHead}>
                <Avatar label={spaceName} seed={namespaceId} square size={48} />
                <div style={{ minWidth: 0 }}>
                  <p className={styles.bigName}>{spaceName}</p>
                  <span className="x-headSub">Space</span>
                </div>
              </div>
              <p className="x-sideText">
                Everyone invited to this space can open any forum in it,
                including forums made later.
              </p>
              <div className="x-sideStats">
                <span>
                  <strong>{forums.length}</strong>
                  {forums.length === 1 ? "forum" : "forums"}
                </span>
                <span>
                  <strong>{joinedCount}</strong>joined
                </span>
              </div>
              <TechDetails rows={[{ label: "Space ID", value: namespaceId }]} />
            </SideCard>
            <SideCard title="Invite people">
              <p className="x-sideText">
                One link joins <strong>{spaceName}</strong> and every forum in
                it. To drop someone straight into one forum, use Invite from
                that forum's menu.
              </p>
              <div className="x-sideForm">
                <button
                  type="button"
                  className="ui-btn ui-btn-dark ui-btn-block"
                  style={{ height: 40 }}
                  onClick={inviteToNamespace}
                  disabled={pending === "invite:namespace"}
                >
                  <UserPlusIcon size={16} />
                  {pending === "invite:namespace"
                    ? "Creating link…"
                    : "Create invite link"}
                </button>
              </div>
            </SideCard>
          </>
        }
      >
        <div className={styles.createRow}>
          <Avatar
            label="+"
            seed="forum-x"
            square
            icon={<PlusIcon size={20} />}
          />
          <input
            id="forum-name"
            className={styles.createInput}
            placeholder="Name a new forum…"
            aria-label="New forum name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="forum-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <button
            className="ui-btn ui-btn-primary"
            onClick={create}
            disabled={pending === "create" || !name.trim() || !appId}
            data-testid="create-forum"
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

        {isSyncing ? (
          <div style={{ padding: 16 }}>
            <JoinSyncBanner show what="forums" onDismiss={dismissSyncing} />
          </div>
        ) : listing ? (
          <div aria-label="Loading…">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : forums.length === 0 ? (
          <div className={styles.empty} data-testid="forums-empty">
            <Avatar
              label="#"
              seed="forum-x"
              square
              size={56}
              icon={<HashIcon size={26} />}
            />
            <span className={styles.emptyTitle}>No forums yet</span>
            Create one above to start the first board in this space.
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              style={{ marginTop: 14 }}
              onClick={focusCreate}
            >
              <PlusIcon size={16} />
              New forum
            </button>
          </div>
        ) : (
          <div className={styles.list}>
            {forums.map((forum) => (
              <div
                key={forum.forumId}
                className={styles.row}
                ref={menuOpenId === forum.forumId ? menuRef : null}
              >
                <button
                  className={styles.rowMain}
                  data-testid="forum-row"
                  disabled={!forum.contextId}
                  onClick={() => enter(forum)}
                >
                  <Avatar
                    label={forum.name}
                    seed={forum.forumId}
                    square
                    size={44}
                    icon={<HashIcon size={20} />}
                  />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>
                      {forum.name}
                      {forum.contextId && forum.joined && (
                        <span className="ui-badge ui-badge-accent">Joined</span>
                      )}
                    </span>
                    <span className={styles.rowMeta}>
                      {forum.contextId ? (
                        <span className={styles.metaItem}>
                          <UsersIcon size={14} />
                          {`${forum.memberCount} member${forum.memberCount === 1 ? "" : "s"}${forum.joined ? "" : " · not joined"}`}
                        </span>
                      ) : (
                        <span className={styles.metaItem}>
                          Syncing to this node — refresh in a moment
                        </span>
                      )}
                    </span>
                  </span>
                  {!forum.contextId ? (
                    <span className={`${styles.pill} ${styles.pillMuted}`}>
                      <span className="ui-spinner" />
                      syncing…
                    </span>
                  ) : pending === `enter:${forum.forumId}` ? (
                    <span className={`${styles.pill} ${styles.pillMuted}`}>
                      <span className="ui-spinner" />
                      Opening
                    </span>
                  ) : forum.joined ? (
                    <span className={styles.pill}>Open</span>
                  ) : (
                    <span className={`${styles.pill} ${styles.pillOutline}`}>
                      Join
                    </span>
                  )}
                </button>
                <div className={styles.menuCell}>
                  <button
                    className="ui-iconBtn"
                    data-testid="forum-menu"
                    title="More options"
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === forum.forumId}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(
                        menuOpenId === forum.forumId ? null : forum.forumId,
                      );
                    }}
                  >
                    <MoreIcon size={18} />
                  </button>
                </div>
                {menuOpenId === forum.forumId && (
                  <div className={styles.dropdown} role="menu">
                    <button
                      className="ui-menuItem"
                      role="menuitem"
                      data-testid="invite-forum"
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteToForum(forum);
                      }}
                    >
                      <UserPlusIcon size={17} />
                      Invite
                    </button>
                    {forum.contextId && (
                      <button
                        className="ui-menuItem"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenId(null);
                          void navigator.clipboard
                            ?.writeText(forum.contextId ?? "")
                            .then(() => showToast("Context ID copied."))
                            .catch(() => undefined);
                        }}
                      >
                        <CopyIcon size={17} />
                        Copy context ID
                      </button>
                    )}
                    <button
                      className="ui-menuItem"
                      role="menuitem"
                      data-danger="true"
                      data-testid="delete-forum"
                      onClick={() => {
                        setMenuOpenId(null);
                        setPendingDelete(forum);
                      }}
                    >
                      <TrashIcon size={17} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Shell>

      <dialog
        ref={deleteDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingDelete(null)}
      >
        <h2 className={styles.confirmTitle}>Delete this forum?</h2>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and every post and comment in
          it will be deleted. This happens for everyone in the space, not just
          on this node, and it cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <button
            className="ui-btn ui-btn-dangerSolid"
            onClick={() => pendingDelete && removeForum(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.forumId}`}
            data-testid="confirm-delete-forum"
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
        scope={invite?.scope ?? ""}
        hint={invite?.hint}
        onClose={() => setInvite(null)}
      />
    </>
  );
}
