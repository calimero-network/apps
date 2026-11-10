import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeError, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { lastUsedName } from "@calimero-apps/names";
import { ConnectExistingOrg } from "@calimero-apps/passkey";
import { useConn } from "../hooks/useConn";
import { useToast } from "../contexts/ToastContext";
import {
  CONNECTED_ROOM_NAME,
  createRoom,
  createStream,
  inviteLink,
  inviteToken,
  listStreams,
  publishMyName,
  type StreamRow,
} from "../lib/streams";
import { storedName } from "../lib/session";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import CopyId from "../components/CopyId";
import {
  ArrowRightIcon,
  BrandMark,
  HashIcon,
  LayersIcon,
  PlusIcon,
  UserPlusIcon,
  UsersIcon,
} from "../components/icons";
import styles from "./Manage.module.css";

/**
 * Streams = ORGANIZATIONS (v1: namespaces).
 *
 *   Organization ("stream")    ← you invite people HERE
 *     └── App instance ("room")   ← one video call   → /streams/:id
 *
 * This page lists the organizations the account belongs to that hold a room
 * or were made here (`orgsWithApp`),
 * creates them, and invites to them. Rooms live on RoomsPage. An invitation
 * reaches the app as an opened link and is redeemed at the app level after
 * sign-in (InvitationPrompt).
 */
export default function StreamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const conn = useConn();
  const { showToast } = useToast();

  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  // Your name in the new stream: asked here, once, and every room in it
  // joins you with it. Offered from the last stream you named yourself in.
  const [selfName, setSelfName] = useState(() => lastUsedName() || storedName());

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; link: string } | null>(
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
        setError(describeError(e));
      } finally {
        setPending(null);
        setStatus(null);
      }
    },
    [],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (!conn) {
        setListing(false);
        return;
      }
      if (showSpinner) setListing(true);
      try {
        setStreams(await listStreams(conn.client, conn.source));
      } catch (e) {
        setError(describeError(e));
      } finally {
        conn.after();
        setListing(false);
      }
    },
    [conn],
  );

  useEffect(() => {
    void load();
  }, [load, location.key]);

  const create = useCallback(() => {
    const streamName = name.trim();
    const yourName = selfName.trim();
    if (!streamName || !yourName || !conn) return;
    void run("create", async (onStatus) => {
      onStatus("Creating the stream, then approve with your passkey so members can create rooms…");
      const { orgId, warning } = await createStream(conn.client, streamName, conn.passkey, conn.source);
      // Best effort: the stream exists either way, and its first room asks
      // for the name once if this did not land.
      await publishMyName(conn.client, orgId, conn.accountId, yourName).catch(() => {});
      conn.after();
      setName("");
      if (warning) showToast(warning);
      onStatus("Refreshing your streams…");
      await load(false);
      navigate(`/streams/${orgId}`);
    });
  }, [name, selfName, conn, run, load, navigate, showToast]);

  // "Connect to an existing organization": a room goes into an org the
  // account has for another app only on this explicit choice.
  const loadOtherOrgs = useCallback(async () => {
    if (!conn) return [];
    try {
      return await otherOrgs(conn.client, conn.source);
    } finally {
      conn.after();
    }
  }, [conn]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      if (!conn) return;
      try {
        await createRoom(conn.client, conn.source, org.orgId, CONNECTED_ROOM_NAME);
      } finally {
        conn.after();
      }
      await load(false);
      navigate(`/streams/${org.orgId}`);
    },
    [conn, load, navigate],
  );

  const mintInvite = useCallback(
    (row: StreamRow) => {
      if (!conn) return;
      void run(`invite:${row.orgId}`, async (onStatus) => {
        onStatus("Approve the invitation with your passkey…");
        const token = await inviteToken(conn.client, row.orgId, conn.passkey());
        conn.after();
        setInvite({
          id: row.orgId,
          link: inviteLink(token, { stream: row.orgId, name: row.name }),
        });
        showToast(`Invite ready for “${row.name}”.`);
      });
    },
    [conn, run, showToast],
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark size={28} />
          <h1 className={styles.brandName}>Mero Stream</h1>
          <span className={styles.version}>v{__APP_VERSION__}</span>
        </div>
        <span className={styles.spacer} />
        <div className={styles.headerActions}>
          <SessionMenu />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <h2 className={styles.title}>Your streams</h2>
            <p
              className={styles.subtitle}
              title="Each room is 640×480 H.264 carried on the node's presence channel, so nothing is written to the app's log."
            >
              A <strong>stream</strong> is a space you invite people to. Each{" "}
              <strong>room</strong> inside it is one video call.
            </p>
          </div>
        </div>

        <div className={styles.toolbar}>
          <span className={styles.toolbarIcon} aria-hidden="true">
            <LayersIcon size={18} />
          </span>
          <input
            className={styles.input}
            placeholder="Name a new stream"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={60}
            disabled={pending === "create"}
            data-testid="stream-name-input"
            aria-label="New stream name"
          />
          <input
            className={styles.input}
            placeholder="Your name in this stream"
            value={selfName}
            onChange={(e) => setSelfName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={40}
            disabled={pending === "create"}
            data-testid="stream-self-name-input"
            aria-label="Your name in this stream"
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            pendingLabel="Creating…"
            disabled={!name.trim() || !selfName.trim() || !conn}
            testId="create-stream"
          >
            <PlusIcon size={16} />
            Create stream
          </ActionButton>
        </div>
        <ConnectExistingOrg appName="Mero Stream" load={loadOtherOrgs} onConnect={connectOrg} />

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

        <InviteModal
          open={!!invite}
          link={invite?.link ?? ""}
          scope={`Whole stream · ${
            streams.find((n) => n.orgId === invite?.id)?.name ?? "stream"
          }`}
          onClose={() => setInvite(null)}
          hint={
            <>
              Whoever opens this link can join that stream and every room in it,
              after signing in with a passkey (or creating an account). To
              invite someone into one specific call, open the stream and use{" "}
              <strong>Invite</strong> on that room.
            </>
          }
        />

        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            {streams.length} stream{streams.length === 1 ? "" : "s"}
          </h3>
          {listing && (
            <span className={styles.sectionNote}>
              <Spinner label="Loading streams" /> loading…
            </span>
          )}
        </div>

        {!listing && streams.length === 0 && (
          <div className={styles.empty} data-testid="streams-empty">
            <span className={styles.emptyIcon} aria-hidden="true">
              <LayersIcon size={20} />
            </span>
            <span className={styles.emptyTitle}>No streams yet</span>
            <span className={styles.emptyHint}>
              Create one above to start a call, or open an invitation link
              someone sent you.
            </span>
          </div>
        )}

        {streams.length > 0 && (
          <div className={styles.grid}>
            {streams.map((row) => (
              <article
                key={row.orgId}
                className={styles.card}
                data-testid="stream-row"
                data-namespace={row.orgId}
              >
                <div className={styles.cardTop}>
                  <span
                    className={`${styles.avatar} ${styles.avatarActive}`}
                    aria-hidden="true"
                  >
                    <LayersIcon size={18} />
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName} title={row.name}>
                      {row.name}
                    </span>
                    <span className={styles.cardMeta}>
                      <span className={styles.pill}>
                        <HashIcon size={12} />
                        {row.roomCount} room{row.roomCount === 1 ? "" : "s"}
                      </span>
                      <span className={styles.pill}>
                        <UsersIcon size={12} />
                        {row.memberCount} member
                        {row.memberCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                </div>
                <CopyId value={row.orgId} label="stream ID" />
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.openBtn}
                    onClick={() => navigate(`/streams/${row.orgId}`)}
                    data-testid="open-stream"
                  >
                    Open
                    <ArrowRightIcon size={16} />
                  </button>
                  {/* Outside any wrapping button: nested interactive elements are
                      invalid HTML and the inner click does not reliably fire. */}
                  <ActionButton
                    onClick={() => mintInvite(row)}
                    pending={pending === `invite:${row.orgId}`}
                    pendingLabel="Minting…"
                    variant="secondary"
                    size="small"
                    testId="invite-btn"
                    title="Invite someone to this whole stream (a passkey approval)"
                  >
                    <UserPlusIcon size={16} />
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
