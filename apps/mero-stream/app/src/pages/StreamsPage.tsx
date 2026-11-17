import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appInviteTeams, appOnlyInviteNote, describeError, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { CreateWorkspaceDialog, InviteDialog } from "@calimero-network/mero-react";
import { lastUsedName } from "@calimero-apps/names";
import { ConnectExistingOrg, reviewRelease, useResolvedSource } from "@calimero-apps/passkey";
import { useConn } from "../hooks/useConn";
import { useToast } from "../contexts/ToastContext";
import {
  CONNECTED_ROOM_NAME,
  createRoom,
  finishStream,
  inviteBase,
  listStreams,
  publishMyName,
  PRODUCT_NAME,
  type StreamRow,
} from "../lib/streams";
import { PACKAGE } from "../lib/meroStream";
import { storedName } from "../lib/session";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
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

const CREATE_LABELS = {
  title: "New stream",
  subtitle: "Name your stream. Each room inside it is one video call.",
  nameLabel: "Stream name",
  namePlaceholder: "e.g. Team",
  selfLabel: "Your name in this stream",
  selfPlaceholder: "e.g. Alice",
};

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
  const [showCreate, setShowCreate] = useState(false);
  const { source: release, pending: releasePending } = useResolvedSource(
    conn?.client ?? null,
    conn?.accountId ?? null,
    conn?.source ?? { package: PACKAGE },
  );

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept after the dialog closes: it stays mounted to finish an invite approved on a full-page trip to the node.
  const [invite, setInvite] = useState<{ row: StreamRow; teams: string[]; appOnly: boolean } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

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

  const created = useCallback(
    ({ orgId, selfName }: { orgId: string; name: string; selfName: string }) => {
      if (!conn) return;
      setShowCreate(false);
      void run("create", async (onStatus) => {
        onStatus("Setting up the stream, then approve with your passkey so members can create rooms…");
        const { warning } = await finishStream(conn.client, orgId, conn.passkey, conn.source);
        // Best effort: the stream exists either way, and its first room asks
        // for the name once if this did not land.
        await publishMyName(conn.client, orgId, conn.accountId, selfName).catch(() => {});
        conn.after();
        if (warning) showToast(warning);
        onStatus("Refreshing your streams…");
        await load(false);
        navigate(`/streams/${orgId}`);
      });
    },
    [conn, run, load, navigate, showToast],
  );

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
        await createRoom(conn.client, conn.source, org.orgId, CONNECTED_ROOM_NAME, conn.passkey);
      } finally {
        conn.after();
      }
      await load(false);
      navigate(`/streams/${org.orgId}`);
    },
    [conn, load, navigate],
  );

  const openInvite = useCallback(
    (row: StreamRow) => {
      if (!conn) return;
      void run(`invite:${row.orgId}`, async () => {
        const { teams, appOnly } = await appInviteTeams(conn.client, row.orgId, conn.source);
        conn.after();
        setInvite({ row, teams, appOnly });
        setInviteOpen(true);
      });
    },
    [conn, run],
  );

  const inviteOrg = invite?.row.orgId ?? streams[0]?.orgId;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark size={28} />
          <h1 className={styles.brandName}>Hyperfeed Stream</h1>
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
          <span className={styles.toolbarLabel}>Name a new stream</span>
          <ActionButton
            onClick={() => setShowCreate(true)}
            pending={pending === "create"}
            pendingLabel="Creating…"
            disabled={!conn}
            testId="create-stream"
          >
            <PlusIcon size={16} />
            New stream
          </ActionButton>
        </div>
        {conn && (
          <CreateWorkspaceDialog
            client={conn.client}
            passkey={conn.passkey()}
            release={releasePending ? null : (reviewRelease(release) ?? { package: PACKAGE })}
            defaultSelfName={lastUsedName() || storedName()}
            open={showCreate}
            onClose={() => setShowCreate(false)}
            onCreated={created}
            labels={CREATE_LABELS}
          />
        )}
        <ConnectExistingOrg appName="Hyperfeed Stream" load={loadOtherOrgs} onConnect={connectOrg} />

        {(location.state as { lostStream?: boolean } | null)?.lostStream && (
          <StatusNote tone="info" testId="stream-lost">
            You no longer have access to that stream.
          </StatusNote>
        )}
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

        {conn && inviteOrg && (
          <InviteDialog
            client={conn.client}
            passkey={conn.passkey()}
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            org={inviteOrg}
            teams={invite?.teams}
            appName={PRODUCT_NAME}
            labels={{
              noun: "stream",
              ...(invite && { title: `Invite to \u201c${invite.row.name}\u201d` }),
              ...(invite?.appOnly && { note: appOnlyInviteNote(PRODUCT_NAME) }),
            }}
            linkBase={invite ? inviteBase({ stream: invite.row.orgId, name: invite.row.name }) : undefined}
          />
        )}

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
                    onClick={() => openInvite(row)}
                    pending={pending === `invite:${row.orgId}`}
                    pendingLabel="Opening…"
                    variant="secondary"
                    size="small"
                    testId="invite-btn"
                    title="Invite someone to this whole stream"
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
