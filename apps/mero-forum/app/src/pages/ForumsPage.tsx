import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveForum, setForumName } from "../lib/session";
import {
  createForum,
  enterForumContext,
  listForums,
  mintNamespaceInvite,
  mintForumInvite,
  type ForumRow,
} from "../lib/groups";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import { initials } from "../lib/people";
import styles from "./Manage.module.css";

/**
 * Forums inside one space (namespace). A forum is a SUBGROUP plus the context bound
 * to it, and that context is the board.
 *
 * The two things this page exists to make possible, both proven by suite S3/S4:
 *
 *   - A namespace can hold MORE THAN ONE call. The old picker created a namespace
 *     and a single context together, so it could not.
 *   - A forum is joinable by someone who only holds the namespace, because it is
 *     created OPEN. Restricted is the default, and a restricted forum answers
 *     `join-via-inheritance` with 403 — invited members could see the space and
 *     never reach the forum.
 *
 * Two invite scopes are offered, and the difference is DESTINATION, not grant:
 * both codes join the space (forum access is inherited from it, so there is no
 * narrower grant to hand out — see `mintForumInvite`), but a forum code drops the
 * joiner straight into that call while a space code leaves them on this list. The
 * hints say so rather than implying the forum code is more restrictive.
 */
export default function ForumsPage() {
  const navigate = useNavigate();
  const { namespaceId = "" } = useParams();
  const { mero } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();

  const [forums, setForums] = useState<ForumRow[]>([]);
  /** Contract roster per forum context, so rows can show WHO is in a call. */
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
              code. It just lands them in this call instead of the forum list.
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
            drop someone directly into one call, use <strong>Invite</strong> on
            that forum.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [mero, namespaceId, nsName, run, showToast]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>Mero Forum</h1>
        </div>
        <span className={styles.spacer} />
        <ActionButton
          onClick={inviteToNamespace}
          pending={pending === "invite:namespace"}
          pendingLabel="Minting…"
          variant="secondary"
          size="small"
          testId="invite-namespace"
          title="Invite someone to this whole space"
        >
          Invite to space
        </ActionButton>
        <ActionButton
          onClick={() => void load()}
          pending={listing}
          pendingLabel="Refreshing…"
          variant="secondary"
          size="small"
          testId="refresh-forums"
        >
          Refresh
        </ActionButton>
        <SessionMenu />
      </header>

      <main className={styles.content}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <button
            type="button"
            className={styles.crumbLink}
            onClick={() => navigate("/spaces")}
            data-testid="back-to-spaces"
          >
            All spaces
          </button>
          <span aria-hidden="true">/</span>
          <span>{nsName || "…"}</span>
        </nav>

        <div className={styles.heading}>
          <h2 className={styles.title}>
            {nsName || <span className={styles.muteInline}>Loading…</span>}
          </h2>
          <p className={styles.subtitle}>
            Each <strong>forum</strong> is one discussion board. Everyone
            invited to this space can join any forum in it — a forum link just
            drops them straight into that call.
          </p>
        </div>

        <div className={styles.toolbar}>
          <input
            className={styles.input}
            placeholder="Name a new forum"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={60}
            disabled={pending === "create"}
            data-testid="forum-name-input"
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            pendingLabel="Creating…"
            disabled={!name.trim() || !mero}
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

        <InviteModal
          open={!!invite}
          code={invite?.code ?? ""}
          scope={invite?.scope ?? ""}
          hint={invite?.hint}
          onClose={() => setInvite(null)}
        />

        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            {forums.length} forum{forums.length === 1 ? "" : "s"}
          </h3>
          {(listing || resolvingAppId) && (
            <span className={styles.sectionNote}>
              <Spinner label="Loading forums" /> loading…
            </span>
          )}
        </div>

        {notInstalled && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              Mero Forum is not installed on this node
            </span>
            <span className={styles.emptyHint}>
              Install it from the marketplace, then reload.
            </span>
          </div>
        )}

        {!listing &&
          !resolvingAppId &&
          !notInstalled &&
          forums.length === 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>No forums in this space</span>
              <span className={styles.emptyHint}>
                Create one above to start a call. Everyone already in the space
                can join it without a new invitation.
              </span>
            </div>
          )}

        {forums.length > 0 && (
          <div className={styles.grid}>
            {forums.map((forum) => (
              <article
                key={forum.forumId}
                className={styles.card}
                data-testid="forum-row"
                data-forum={forum.forumId}
                data-joined={forum.joined}
              >
                <div className={styles.cardTop}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(forum.name)}
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName} title={forum.name}>
                      {forum.name}
                    </span>
                    <span className={styles.cardMeta}>
                      <span className={styles.pill}>
                        {forum.memberCount} member
                        {forum.memberCount === 1 ? "" : "s"}
                      </span>
                      {/* Three distinct states, and the third is not a failure:
                          a forum whose context has not replicated to this node
                          yet cannot be entered, and saying so beats a button
                          that does nothing. */}
                      {!forum.contextId ? (
                        <span
                          className={`${styles.pill} ${styles.pillWaiting}`}
                        >
                          syncing
                        </span>
                      ) : forum.joined ? (
                        <span className={`${styles.pill} ${styles.pillJoined}`}>
                          joined
                        </span>
                      ) : (
                        <span className={styles.pill}>not joined</span>
                      )}
                    </span>
                  </span>
                </div>
                {/* WHO is in the forum, by the name they chose — not the raw
                    context id, which answers no question anyone has. Falls
                    back to the id only while the roster is unknown (not
                    joined, or still loading). */}
                <span
                  className={styles.cardId}
                  title={forum.contextId ?? ""}
                  data-testid="forum-context"
                >
                  {forum.contextId ?? "waiting for the context to replicate"}
                </span>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.openBtn}
                    onClick={() => enter(forum)}
                    data-testid="enter-forum"
                    disabled={
                      pending === `enter:${forum.forumId}` || !forum.contextId
                    }
                  >
                    {pending === `enter:${forum.forumId}` ? (
                      <>
                        <Spinner label="Joining" /> joining…
                      </>
                    ) : forum.joined ? (
                      "Open call"
                    ) : (
                      "Join call"
                    )}
                  </button>
                  <ActionButton
                    onClick={() => inviteToForum(forum)}
                    pending={pending === `invite:${forum.forumId}`}
                    pendingLabel="Minting…"
                    variant="secondary"
                    testId="invite-forum"
                    title="Invite someone straight into this forum"
                  >
                    Invite
                  </ActionButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
