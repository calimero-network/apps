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
import styles from "./ForumsPage.module.css";
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
  const { mero, logout } = useMero();
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

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/spaces")}>
          ← Spaces
        </button>
        <span className={styles.logo}>{nsName || "Space"}</span>
        <div className={styles.headerRight}>
          <button
            className={styles.logoutBtn}
            onClick={inviteToNamespace}
            disabled={pending === "invite-ns"}
            data-testid="invite-space"
          >
            {pending === "invite-ns" ? "Inviting…" : "Invite"}
          </button>
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Forums</h1>

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New forum name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="forum-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <button
            className={styles.btn}
            onClick={create}
            disabled={pending === "create" || !name.trim() || !appId}
            data-testid="create-forum"
          >
            {pending === "create" ? "Creating…" : "Create"}
          </button>
        </div>

        {status && <p className={styles.empty}>{status}</p>}
        {error && <p className={styles.joinError}>{error}</p>}

        {isSyncing ? (
          <JoinSyncBanner show what="forums" onDismiss={dismissSyncing} />
        ) : listing ? (
          <p className={styles.empty}>Loading…</p>
        ) : forums.length === 0 ? (
          <p className={styles.empty} data-testid="forums-empty">
            No forums yet. Create one above.
          </p>
        ) : (
          <div className={styles.grid}>
            {forums.map((forum) => (
              <div
                key={forum.forumId}
                className={styles.cardWrap}
                ref={menuOpenId === forum.forumId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  data-testid="forum-row"
                  disabled={!forum.contextId}
                  onClick={() => enter(forum)}
                >
                  <span className={styles.cardName}>{forum.name}</span>
                  <span className={styles.cardSub}>
                    {forum.contextId
                      ? `${forum.memberCount} member${forum.memberCount === 1 ? "" : "s"}${forum.joined ? "" : " · not joined"}`
                      : "syncing…"}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="forum-menu"
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === forum.forumId ? null : forum.forumId,
                    );
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === forum.forumId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      data-testid="invite-forum"
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteToForum(forum);
                      }}
                    >
                      Invite
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      data-testid="delete-forum"
                      onClick={() => {
                        setMenuOpenId(null);
                        setPendingDelete(forum);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

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
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => pendingDelete && removeForum(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.forumId}`}
            data-testid="confirm-delete-forum"
          >
            Delete
          </button>
          <button
            className={styles.logoutBtn}
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </button>
        </div>
      </dialog>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={invite?.scope ?? ""}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
