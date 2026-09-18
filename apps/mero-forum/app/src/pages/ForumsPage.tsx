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
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import CardMenu from "../components/CardMenu";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./Shell.module.css";

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
  const { mero } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId } = useApplicationId();

  const [forums, setForums] = useState<ForumRow[]>([]);
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
        <span className={styles.logo}>
          Mero Forum{" "}
          <span className={styles.logoVersion}>v{__APP_VERSION__}</span>
        </span>
        <div className={styles.headerRight}>
          <ActionButton
            onClick={inviteToNamespace}
            pending={pending === "invite-ns"}
            variant="secondary"
            testId="invite-space"
            title="Invite someone to this whole space"
          >
            Invite to space
          </ActionButton>
          <SessionMenu />
        </div>
      </header>

      <main className={styles.main}>
        <nav className={styles.crumbs}>
          <button
            className={styles.crumbLink}
            onClick={() => navigate("/spaces")}
          >
            All spaces
          </button>
          <span>/</span>
          <span>{nsName || "Space"}</span>
        </nav>

        <h1 className={styles.title}>{nsName || "Space"}</h1>
        <p className={styles.subtitle}>
          Each <strong>forum</strong> is a discussion board with its own posts
          and comments. Everyone invited to this space can read and post in any
          forum in it, and a forum link opens that board directly.
        </p>

        <div className={styles.createRow}>
          <input
            className={styles.createInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name a new forum"
            aria-label="Name a new forum"
            data-testid="forum-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            disabled={!name.trim() || !appId}
            testId="create-forum"
          >
            Create forum
          </ActionButton>
        </div>

        {status && (
          <StatusNote tone="pending" testId="forums-status">
            {status}
          </StatusNote>
        )}
        {error && (
          <StatusNote tone="error" testId="forums-error">
            {error}
          </StatusNote>
        )}

        {listing ? (
          <Spinner label="Loading forums…" />
        ) : forums.length === 0 ? (
          <div className={styles.empty} data-testid="forums-empty">
            No forums in this space yet. Create one above — everyone already
            invited to the space will see it.
          </div>
        ) : (
          <>
            <div className={styles.sectionLabel}>
              {forums.length} forum{forums.length === 1 ? "" : "s"}
            </div>
            <div className={styles.grid}>
              {forums.map((forum) => (
                <div className={styles.cardWrap} key={forum.forumId}>
                  <CardMenu
                    testId="forum-menu"
                    label={`Actions for ${forum.name}`}
                    items={[
                      {
                        label: "Delete forum",
                        danger: true,
                        testId: "delete-forum",
                        onSelect: () => setPendingDelete(forum),
                      },
                    ]}
                  />
                  <div className={styles.card} data-testid="forum-row">
                    <span className={styles.cardName}>{forum.name}</span>
                    <div className={styles.cardMeta}>
                      <span className={styles.chip}>
                        {forum.memberCount} member
                        {forum.memberCount === 1 ? "" : "s"}
                      </span>
                      {forum.joined ? (
                        <span className={styles.chip}>joined</span>
                      ) : forum.contextId ? (
                        <span className={styles.chip}>not joined</span>
                      ) : (
                        /* No context on this node yet. It is a real, temporary
                         state — the subgroup exists and its context has not
                         replicated here — so it says that rather than showing
                         an Open button that cannot work. */
                        <span className={`${styles.chip} ${styles.chipWarn}`}>
                          syncing
                        </span>
                      )}
                    </div>
                    {forum.contextId ? (
                      <span className={styles.cardId} title={forum.contextId}>
                        {forum.contextId.slice(0, 10)}…
                      </span>
                    ) : (
                      <span className={styles.cardId}>
                        waiting to replicate
                      </span>
                    )}
                    <div className={styles.cardActions}>
                      <ActionButton
                        onClick={() => enter(forum)}
                        pending={pending === `enter:${forum.forumId}`}
                        disabled={!forum.contextId}
                        testId="enter-forum"
                      >
                        {forum.joined ? "Open" : "Join"}
                      </ActionButton>
                      <ActionButton
                        onClick={() => inviteToForum(forum)}
                        pending={pending === `invite:${forum.forumId}`}
                        variant="secondary"
                        testId="invite-forum"
                        title="Invite someone straight into this forum"
                      >
                        Invite
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <dialog
        ref={deleteDialogRef}
        className={styles.joinDialog}
        onClose={() => setPendingDelete(null)}
      >
        <h2>Delete this forum?</h2>
        <p className={styles.confirmText}>
          <span className={styles.confirmStrong}>{pendingDelete?.name}</span>{" "}
          and every post and comment in it will be deleted. This happens for
          everyone in the space, not just on this node, and it cannot be undone.
        </p>
        <div className={styles.cardActions}>
          <ActionButton
            onClick={() => pendingDelete && removeForum(pendingDelete)}
            pending={pending === `delete:${pendingDelete?.forumId}`}
            variant="danger"
            testId="confirm-delete-forum"
          >
            Delete forum
          </ActionButton>
          <ActionButton
            onClick={() => setPendingDelete(null)}
            variant="secondary"
          >
            Cancel
          </ActionButton>
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
