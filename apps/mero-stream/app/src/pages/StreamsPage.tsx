import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveRoom, setRoomName } from "../lib/session";
import { decodeInvite } from "../lib/inviteCodec";
import {
  createStreamNamespace,
  listStreamNamespaces,
  mintNamespaceInvite,
  redeemInvite,
  type NamespaceRow,
} from "../lib/groups";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import { initials } from "../lib/people";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import { invitationFromRaw } from "../lib/inviteLink";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./Manage.module.css";

/**
 * Streams = NAMESPACES. One level up from where this page used to sit.
 *
 * It used to list contexts and call each one a "stream", which collapsed two
 * distinct things into one and left no room for rooms: creating a stream made a
 * namespace plus a context and nothing could ever add a second call to it. The
 * model that actually matches Calimero, and what the two-node suite proves:
 *
 *   Namespace ("stream")  ← you invite people HERE
 *     └── Subgroup ("room") + Context   ← one video call   → /streams/:id
 *
 * So: this page creates namespaces, invites to namespaces, and accepts any invite
 * code. Rooms live on RoomsPage.
 *
 * Invite codes are the SAME format mero-chat and mero-blocks use — one base58
 * token of deflated JSON (lib/inviteCodec) — so a code minted by any of them
 * decodes here, and a code from here pastes into a chat window without being
 * mangled.
 */
export default function StreamsPage() {
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
        setNamespaces(await listStreamNamespaces(mero.admin, appId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load streams.");
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
    const streamName = name.trim();
    if (!streamName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Stream from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { namespaceId } = await createStreamNamespace(
        mero.admin,
        { applicationId: appId, name: streamName },
        onStatus,
      );
      setName("");
      onStatus("Refreshing your streams…");
      await load(false);
      // Straight into the new namespace: it has no rooms yet, and making one is
      // the only useful next step.
      navigate(`/streams/${namespaceId}`);
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
   * Accept any code: a namespace invite, or a room invite (which carries the
   * namespace invitation too, so someone with no prior membership gets both joins
   * from one paste). A room code that names its context takes you into the call.
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
        // Shared with the app-level link prompt, so the two cannot drift. A room
        // invitation needs BOTH joins — the namespace grant and the room's
        // context — and this sequence is where that lives.
        const landed = await redeemInvite(mero.admin, payload, onStatus);
        setJoinCode("");
        onStatus("Refreshing your streams…");
        await load(false);

        if (landed.kind === "room") {
          if (landed.roomName) setRoomName(landed.contextId, landed.roomName);
          setActiveRoom(landed.contextId, landed.identity, landed.namespaceId);
          navigate("/live");
          return;
        }
        if (landed.kind === "namespace") {
          navigate(`/streams/${landed.namespaceId}`);
          return;
        }
        showToast("Joined. Your streams are listed below.");
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
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>Mero Stream</h1>
          <span className={styles.version}>v{__APP_VERSION__}</span>
        </div>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setShowJoin(true)}
          data-testid="open-join"
        >
          Join with a link or code
        </button>
        <SessionMenu />
      </header>

      <main className={styles.content}>
        <div className={styles.heading}>
          <h2 className={styles.title}>Your streams</h2>
          <p className={styles.subtitle}>
            A <strong>stream</strong> is a namespace you invite people to.
            Inside it, each <strong>room</strong> is one video call — 640×480
            H.264 carried on ephemeral presence, so nothing is written to
            replicated state.
          </p>
        </div>

        <div className={styles.toolbar}>
          <input
            className={styles.input}
            placeholder="Name a new stream"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={60}
            disabled={pending === "create"}
            data-testid="stream-name-input"
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            pendingLabel="Creating…"
            disabled={!name.trim() || !mero}
            testId="create-stream"
          >
            Create stream
          </ActionButton>
        </div>

        {/* Step-level status: these flows are 3-6 round-trips deep, and naming
            the step is what separates "loading" from "hung". */}
        {status && (
          <StatusNote tone="pending" testId="streams-status">
            {status}
          </StatusNote>
        )}
        {error && (
          <StatusNote tone="error" testId="streams-error">
            {error}
          </StatusNote>
        )}

        {/* A modal, not an inline panel. Expanding in place pushed the list
            down, so the row you just clicked moved out from under the pointer,
            and it stayed open until something replaced it — a stale invitation
            for one stream reading as current while you looked at another. */}
        <InviteModal
          open={!!invite}
          code={invite?.code ?? ""}
          scope={`Whole stream · ${
            namespaces.find((n) => n.namespaceId === invite?.id)?.name ??
            "stream"
          }`}
          onClose={() => setInvite(null)}
          hint={
            <>
              Anyone with this link can join that stream and every room in it.
              Opening it shows them what they have been invited to and a Join
              button — in the web app, the installed app, or the desktop
              launcher. To invite someone into one specific call, open the
              stream and use <strong>Invite</strong> on that room.
            </>
          }
        />

        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            {namespaces.length} stream{namespaces.length === 1 ? "" : "s"}
          </h3>
          {(listing || resolvingAppId) && (
            <span className={styles.sectionNote}>
              <Spinner label="Loading streams" /> loading…
            </span>
          )}
        </div>

        {/* "Not installed" is its own state, distinct from "no streams". The
            list is scoped to this app's id, so without one there is nothing to
            scope BY — showing "No streams yet" there invites you to create one,
            and the create would fail for a reason the empty state never named. */}
        {notInstalled && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              Mero Stream is not installed on this node
            </span>
            <span className={styles.emptyHint}>
              Install it from the marketplace, then reload. Streams are listed per
              application, so there is nothing to show until the node has this one.
            </span>
          </div>
        )}

        {!listing && !resolvingAppId && !notInstalled && namespaces.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>No streams yet</span>
            <span className={styles.emptyHint}>
              Create one above to start a call, or use{" "}
              <strong>Join with a link or code</strong> if someone invited you.
            </span>
          </div>
        )}

        {namespaces.length > 0 && (
          <div className={styles.grid}>
            {namespaces.map((ns) => (
              <article
                key={ns.namespaceId}
                className={styles.card}
                data-testid="stream-row"
                data-namespace={ns.namespaceId}
              >
                <div className={styles.cardTop}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(ns.name)}
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName} title={ns.name}>
                      {ns.name}
                    </span>
                    <span className={styles.cardMeta}>
                      <span className={styles.pill}>
                        {ns.roomCount} room{ns.roomCount === 1 ? "" : "s"}
                      </span>
                      <span className={styles.pill}>
                        {ns.memberCount} member
                        {ns.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                </div>
                <span className={styles.cardId} title={ns.namespaceId}>
                  {ns.namespaceId}
                </span>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.openBtn}
                    onClick={() => navigate(`/streams/${ns.namespaceId}`)}
                    data-testid="open-stream"
                  >
                    Open
                  </button>
                  {/* Outside any wrapping button: nested interactive elements are
                      invalid HTML and the inner click does not reliably fire. */}
                  <ActionButton
                    onClick={() => mintInvite(ns)}
                    pending={pending === `invite:${ns.namespaceId}`}
                    pendingLabel="Minting…"
                    variant="secondary"
                    testId="invite-btn"
                    title="Invite someone to this whole stream"
                  >
                    Invite
                  </ActionButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <dialog
        ref={joinDialogRef}
        className={styles.dialog}
        data-testid="join-dialog"
        onClose={() => setShowJoin(false)}
      >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>Join a stream or room</h2>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setShowJoin(false)}
            data-testid="join-dialog-close"
          >
            Close
          </button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.dialogRow}>
            <input
              className={styles.dialogInput}
              placeholder="Paste an invite link or code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              disabled={pending === "join"}
              data-testid="join-code-input"
              aria-label="Invite link or code"
            />
            <ActionButton
              onClick={join}
              pending={pending === "join"}
              pendingLabel="Joining…"
              disabled={!joinCode.trim() || !mero}
              testId="join-submit"
            >
              Join
            </ActionButton>
          </div>
          <p className={styles.help}>
            An invite <strong>link</strong> normally just needs opening — it
            brings you here and joins on its own. Paste one in only if it did
            not survive however it was sent to you. A raw <strong>code</strong>{" "}
            is one long line of base58 with no spaces, and any mero app&apos;s
            code works here.
          </p>
        </div>
      </dialog>
    </div>
  );
}
