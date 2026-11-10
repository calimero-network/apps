import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { askAnOwnerCopy, canCreateIn, describeError } from "@calimero-apps/connect";

import { useToast } from "../contexts/ToastContext";
import { useSignedIn } from "../sessionContext";
import { setActiveForum, setForumName } from "../lib/session";
import {
  createForum,
  deleteForum,
  inviteLink,
  inviteToken,
  isSpaceAdmin,
  listForums,
  readMembers,
  roleIn,
  type ForumRow,
} from "../lib/spaces";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { Avatar, NavItem, Shell, SideCard, TechDetails } from "../components/chrome";
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

/**
 * Forums inside one space (an organization). A forum is an instance of this
 * app created in the org, so every member of the space reaches it, including
 * forums made after they joined. v1 needed a subgroup plus a context per forum,
 * an "open" subgroup so members could join it, and a join step (and a wait for
 * the context to replicate) before a forum could be read; none of that exists
 * any more: opening a forum is choosing it.
 *
 * Two invite scopes are offered, and the difference is DESTINATION, not grant:
 * both links join the space, but a forum link drops the joiner straight into
 * that forum while a space link leaves them on this list.
 */
export default function ForumsPage() {
  const { namespaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { client, accountId, source, passkey, after } = useSignedIn();

  const [forums, setForums] = useState<ForumRow[]>([]);
  const [spaceAdmin, setSpaceAdmin] = useState(false);
  /**
   * Whether this account may add a forum in the space (core's `CREATE_APP`):
   * an owner or admin, or a member allowed to (the space's defaults, set by a
   * best-effort step-up when it was made). `null` while unknown, when the
   * create is offered and the node decides.
   */
  const [mayCreate, setMayCreate] = useState<boolean | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  /** The space whose forum list has come back at least once. */
  const [listedForNs, setListedForNs] = useState<string | null>(null);
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ForumRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  const run = useCallback(
    async (key: string, fn: (onStatus: (m: string) => void) => Promise<void>) => {
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

  // Whether the last forum read failed, so the next good one clears its error
  // and only its error — not one an action on this page has since reported.
  const listFailed = useRef(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!namespaceId) return;
      if (showSpinner) setListing(true);
      try {
        // The space's own name for the header, and who is in it.
        const members = await readMembers(client, namespaceId).catch(() => null);
        setNsName((members?.name ?? "").trim() || `Space ${namespaceId.slice(0, 6)}`);
        setMemberCount(members ? members.roles.size : null);
        void roleIn(client, namespaceId)
          .then((role) => setSpaceAdmin(isSpaceAdmin(role ?? undefined)))
          .catch(() => setSpaceAdmin(false));
        void canCreateIn(client, namespaceId).then(setMayCreate);
        setForums(await listForums(client, source, namespaceId));
        setListedForNs(namespaceId);
        if (listFailed.current) setError(null);
        listFailed.current = false;
      } catch (e) {
        listFailed.current = true;
        setError(describeError(e));
      } finally {
        setListing(false);
        after();
      }
    },
    [client, source, namespaceId, after],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    (forum: ForumRow) => {
      setForumName(forum.forumId, forum.name);
      setActiveForum(forum.forumId, namespaceId);
      navigate("/f");
    },
    [navigate, namespaceId],
  );

  const create = useCallback(() => {
    const forumName = name.trim();
    if (!forumName) return;
    void run("create", async (onStatus) => {
      onStatus("Creating the forum…");
      const forumId = await createForum(client, source, namespaceId, forumName);
      setName("");
      // Into the forum: there is nothing to join or wait for.
      open({ forumId, contextId: forumId, name: forumName, owner: accountId });
    });
  }, [name, client, source, namespaceId, accountId, run, open]);

  const inviteToForum = useCallback(
    (forum: ForumRow) => {
      void run(`invite:${forum.forumId}`, async (onStatus) => {
        onStatus("Approve the invitation with your passkey…");
        const token = await inviteToken(client, namespaceId, passkey());
        setInvite({
          key: `forum:${forum.forumId}`,
          code: inviteLink(token, forum.forumId, window.location, namespaceId),
          scope: `Opens ${forum.name}`,
          hint: (
            <>
              Opening the link puts them straight into{" "}
              <strong>{forum.name}</strong>. Note what it grants: joining{" "}
              <strong>{nsName}</strong>, which is what makes any forum in it
              reachable, so this is <em>not</em> narrower than the space link.
              It just lands them in this forum instead of the forum list.
            </>
          ),
        });
        showToast(`Invite ready for “${forum.name}”.`);
      });
    },
    [client, passkey, namespaceId, nsName, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    void run("invite:namespace", async (onStatus) => {
      onStatus("Approve the invitation with your passkey…");
      const token = await inviteToken(client, namespaceId, passkey());
      setInvite({
        key: "namespace",
        code: inviteLink(token, undefined, window.location, namespaceId),
        scope: `Whole space · ${nsName}`,
        hint: (
          <>
            This link joins <strong>{nsName}</strong> and every forum in it,
            including forums made later. It lands them on the forum list — to
            drop someone directly into one forum, use <strong>Invite</strong> on
            that forum.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [client, passkey, namespaceId, nsName, run, showToast]);

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
      setPendingDelete(null);
      void run(`delete:${forum.forumId}`, async (onStatus) => {
        onStatus("Deleting the forum…");
        await deleteForum(client, forum.forumId);
        onStatus("Refreshing forums…");
        await load(false);
        showToast(`Deleted \u201c${forum.name}\u201d.`);
      });
    },
    [client, run, load, showToast],
  );

  const spaceName = nsName || "Space";

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
              label={pending === "invite:namespace" ? "Inviting…" : "Invite people"}
              onClick={inviteToNamespace}
              disabled={pending === "invite:namespace"}
              testId="invite-space"
            />
          </>
        }
        cta={
          mayCreate === false ? undefined : (
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
          )
        }
        account={<SessionMenu />}
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
                {memberCount !== null && (
                  <span>
                    <strong>{memberCount}</strong>
                    {memberCount === 1 ? "member" : "members"}
                  </span>
                )}
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
        {mayCreate === false ? (
          <p className={styles.note} role="status" data-testid="create-forum-ask">
            {askAnOwnerCopy("a forum")}
          </p>
        ) : (
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
              disabled={pending === "create" || !name.trim()}
              data-testid="create-forum"
            >
              {pending === "create" && <span className="ui-spinner" />}
              {pending === "create" ? "Creating…" : "Create"}
            </button>
          </div>
        )}

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

        {listing ? (
          <div aria-label="Loading…">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : forums.length === 0 && listedForNs !== namespaceId ? (
          // The list has never answered for this space: a failed read is not
          // "no forums", and offering a create here would duplicate one.
          <div className={styles.empty} data-testid="forums-list-failed">
            <span className={styles.emptyTitle}>
              This space's forums could not be loaded
            </span>
            Try again before creating one.
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => void load()}
              data-testid="forums-retry"
            >
              Try again
            </button>
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
            {mayCreate === false ? (
              "An owner or admin of this space can add the first one."
            ) : (
              <>
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
              </>
            )}
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
                  onClick={() => open(forum)}
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
                      {forum.owner === accountId && (
                        <span className="ui-badge ui-badge-accent">Yours</span>
                      )}
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.metaItem}>
                        <UsersIcon size={14} />
                        {memberCount === null
                          ? "Everyone in the space"
                          : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </span>
                  <span className={styles.pill}>Open</span>
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
                    <button
                      className="ui-menuItem"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpenId(null);
                        void navigator.clipboard
                          ?.writeText(forum.forumId)
                          .then(() => showToast("Forum ID copied."))
                          .catch(() => undefined);
                      }}
                    >
                      <CopyIcon size={17} />
                      Copy forum ID
                    </button>
                    {(spaceAdmin || forum.owner === accountId) && (
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
                    )}
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
          it will be deleted. This happens for everyone in the space, and it
          cannot be undone.
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
