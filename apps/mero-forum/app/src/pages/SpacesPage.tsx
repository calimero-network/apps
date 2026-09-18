import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveForum, setForumName } from "../lib/session";
import { decodeInvite } from "../lib/inviteCodec";
import {
  createSpaceNamespace,
  listSpaceNamespaces,
  mintNamespaceInvite,
  redeemInvite,
  type NamespaceRow,
} from "../lib/groups";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import { invitationFromRaw } from "../lib/inviteLink";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./Shell.module.css";

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
 * So: this page creates namespaces, invites to namespaces, and accepts any invite
 * code. Forums live on ForumsPage.
 *
 * Invite codes are the SAME format mero-chat and mero-blocks use — one base58
 * token of deflated JSON (lib/inviteCodec) — so a code minted by any of them
 * decodes here, and a code from here pastes into a chat window without being
 * mangled.
 */
export default function SpacesPage() {
  const navigate = useNavigate();
  const { mero } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const joinDialogRef = useRef<HTMLDialogElement | null>(null);

  // One key names the action in flight ("create", "join", `invite:<id>`), instead
  // of a single `busy` boolean. With a boolean, clicking Invite disabled Create,
  // Join and every row, and all of them read "Working…" — indistinguishable from
  // the page having locked up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string } | null>(
    null,
  );

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

  useEffect(() => {
    void load();
  }, [load]);

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

  /**
   * Accept any code: a namespace invite, or a forum invite (which carries the
   * namespace invitation too, so someone with no prior membership gets both joins
   * from one paste). A forum code that names its context takes you into the forum.
   */
  const acceptCode = useCallback(
    (raw: string) => {
      if (!mero) return;
      // Accept a LINK pasted into the code field, not just a code. People paste
      // whatever they were sent, and the two are indistinguishable to them —
      // rejecting a link here would be the app refusing its own invitation.
      // Accepts a platform link, a `calimero://` deep link, this app's older
      // `?invite=` link, or the bare code — people paste whatever they were sent.
      const candidate = invitationFromRaw(raw) ?? raw;
      const payload = decodeInvite(candidate);
      if (!payload) {
        setError(
          "That invite is not valid. If you pasted a code, paste the whole thing — it is one long line with no spaces.",
        );
        return;
      }
      void run("join", async (onStatus) => {
        // Shared with the app-level link prompt, so the two cannot drift. A forum
        // invitation needs BOTH joins — the namespace grant and the forum's
        // context — and this sequence is where that lives.
        const landed = await redeemInvite(mero.admin, payload, onStatus);
        setJoinCode("");
        onStatus("Refreshing your spaces…");
        await load(false);

        if (landed.kind === "forum") {
          if (landed.forumName)
            setForumName(landed.contextId, landed.forumName);
          setActiveForum(landed.contextId, landed.identity, landed.namespaceId);
          navigate("/f");
          return;
        }
        if (landed.kind === "namespace") {
          navigate(`/spaces/${landed.namespaceId}`);
          return;
        }
        showToast("Joined. Your spaces are listed below.");
      });
    },
    [mero, run, load, navigate, showToast],
  );

  const join = useCallback(() => {
    acceptCode(joinCode);
    setShowJoin(false);
  }, [acceptCode, joinCode]);

  useDialogOpen(joinDialogRef, showJoin);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          Mero Forum{" "}
          <span className={styles.logoVersion}>v{__APP_VERSION__}</span>
        </span>
        <div className={styles.headerRight}>
          {/* Secondary: joining is the rarer path, and a filled accent button
              here competes with Create for the eye on the one screen whose job
              is to get you into a space. */}
          <ActionButton
            onClick={() => setShowJoin(true)}
            pending={pending === "join"}
            variant="secondary"
            testId="open-join"
          >
            Join with a link or code
          </ActionButton>
          <SessionMenu />
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your spaces</h1>
        <p className={styles.subtitle}>
          A <strong>space</strong> is a namespace you invite people to. Inside
          it, each <strong>forum</strong> is a discussion board with its own
          posts and comments. Invite someone to the space once and every forum
          in it is open to them.
        </p>

        <div className={styles.createRow}>
          <input
            className={styles.createInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name a new space"
            aria-label="Name a new space"
            data-testid="space-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            disabled={!name.trim() || !appId}
            testId="create-space"
          >
            Create space
          </ActionButton>
        </div>

        {status && (
          <StatusNote tone="pending" testId="spaces-status">
            {status}
          </StatusNote>
        )}
        {error && (
          <StatusNote tone="error" testId="spaces-error">
            {error}
          </StatusNote>
        )}

        {notInstalled && (
          <div className={styles.notice}>
            <div className={styles.noticeTitle}>
              Mero Forum is not installed on this node
            </div>
            Install it from the marketplace, then reload. Spaces are listed per
            application, so there is nothing to show until this node has this
            one.
          </div>
        )}

        {listing || resolvingAppId ? (
          <Spinner label="Loading your spaces…" />
        ) : namespaces.length === 0 ? (
          !notInstalled && (
            <div className={styles.empty} data-testid="spaces-empty">
              No spaces yet. Create one above, or join one you were invited to.
            </div>
          )
        ) : (
          <>
            <div className={styles.sectionLabel}>
              {namespaces.length} space{namespaces.length === 1 ? "" : "s"}
            </div>
            <div className={styles.grid}>
              {namespaces.map((ns) => (
                <div
                  className={styles.card}
                  key={ns.namespaceId}
                  data-testid="space-row"
                >
                  <span className={styles.cardName}>{ns.name}</span>
                  <div className={styles.cardMeta}>
                    <span className={styles.chip}>
                      {ns.forumCount} forum{ns.forumCount === 1 ? "" : "s"}
                    </span>
                    <span className={styles.chip}>
                      {ns.memberCount} member{ns.memberCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {/* The id is a fallback for telling two same-named spaces
                      apart — deliberately not the headline, which is what made
                      every card read as a hex string. */}
                  <span className={styles.cardId} title={ns.namespaceId}>
                    {ns.namespaceId.slice(0, 10)}…
                  </span>
                  <div className={styles.cardActions}>
                    <ActionButton
                      onClick={() => navigate(`/spaces/${ns.namespaceId}`)}
                      testId="open-space"
                    >
                      Open
                    </ActionButton>
                    <ActionButton
                      onClick={() => mintInvite(ns)}
                      pending={pending === `invite:${ns.namespaceId}`}
                      variant="secondary"
                      testId="invite-btn"
                      title="Invite someone to this whole space"
                    >
                      Invite
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={`Whole space · ${namespaces.find((n) => n.namespaceId === invite?.id)?.name ?? ""}`}
        onClose={() => setInvite(null)}
      />

      <dialog
        ref={joinDialogRef}
        className={styles.joinDialog}
        onClose={() => setShowJoin(false)}
      >
        <h2>Join a space or forum</h2>
        <p>
          An invite link normally just needs opening — it brings you here and
          joins on its own. Paste one in only if it did not survive however it
          was sent to you. A raw code is one long line of base58 with no spaces,
          and any mero app's code works here.
        </p>
        <textarea
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Paste an invite link or code"
          aria-label="Invite link or code"
          rows={3}
          data-testid="join-input"
        />
        <div className={styles.cardActions}>
          <ActionButton
            onClick={join}
            pending={pending === "join"}
            disabled={!joinCode.trim()}
            testId="join-btn"
          >
            Join
          </ActionButton>
          <ActionButton onClick={() => setShowJoin(false)} variant="secondary">
            Close
          </ActionButton>
        </div>
      </dialog>
    </div>
  );
}
