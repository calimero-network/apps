import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { askAnOwnerCopy, canCreateIn, describeError } from "@calimero-apps/connect";
import { useConn } from "../hooks/useConn";
import { useToast } from "../contexts/ToastContext";
import { setActiveRoom, setRoomName } from "../lib/session";
import {
  createRoom,
  inviteLink,
  inviteToken,
  listRooms,
  membersCreateRooms,
  setMembersCreateRooms,
  streamInfo,
  type RoomRow,
} from "../lib/streams";
import { meroStream } from "../lib/meroStream";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import {
  labelMembers,
  summariseMembers,
  type RoomMemberLabel,
} from "../lib/roomMembers";
import type { Member } from "../types";
import {
  BrandMark,
  ChevronRightIcon,
  HashIcon,
  PlusIcon,
  RefreshIcon,
  UserPlusIcon,
  UsersIcon,
  VideoIcon,
} from "../components/icons";
import styles from "./Manage.module.css";

/**
 * The rooms of one stream.
 *
 * A stream is an organization and a room is an app instance in it (v1: a
 * subgroup with its own context). Everyone in the organization reaches every
 * room, so there is no per-room join step any more: "Join call" opens the
 * room, and the call's own `join` records the name.
 */
export default function RoomsPage() {
  const navigate = useNavigate();
  const { namespaceId: orgId = "" } = useParams();
  const conn = useConn();
  const { showToast } = useToast();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  /** Contract roster per room, so rows can show WHO is in a call. */
  const [rosters, setRosters] = useState<Record<string, Member[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [listing, setListing] = useState(true);
  const [nsName, setNsName] = useState("");
  const [name, setName] = useState("");
  /**
   * Whether this account may add a room (core's `CREATE_APP`): an owner or
   * admin may, a plain member only when allowed. `null` while unknown, when
   * the create row is shown and the node decides.
   */
  const [mayCreate, setMayCreate] = useState<boolean | null>(null);
  /** The caller's role here, and the org's member defaults, for the owner's setting. */
  const [myRole, setMyRole] = useState<string | null>(null);
  const [memberDefaults, setMemberDefaults] = useState<number | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    key: string;
    link: string;
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
      if (!conn || !orgId) return;
      if (showSpinner) setListing(true);
      try {
        const [info, list, may] = await Promise.all([
          streamInfo(conn.client, orgId),
          listRooms(conn.client, conn.source, orgId),
          canCreateIn(conn.client, orgId),
        ]);
        setMayCreate(may);
        setMyRole(conn.accountId ? (info.roles[conn.accountId] ?? null) : null);
        setMemberDefaults(info.memberDefaults);
        setNsName(info.name);
        setNames(info.names);
        setRooms(list);
      } catch (e) {
        setError(describeError(e));
      } finally {
        conn.after();
        setListing(false);
      }
    },
    [conn, orgId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Each room's roster, read from its contract: who has joined the call.
  useEffect(() => {
    if (!conn || rooms.length === 0) return;
    let cancelled = false;
    void Promise.all(
      rooms.map(async (room) => {
        try {
          const members = await meroStream(conn.client, room.appId).getMembers();
          return [room.appId, members] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      conn.after();
      if (cancelled) return;
      const next: Record<string, Member[]> = {};
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      setRosters(next);
    });
    return () => {
      cancelled = true;
    };
  }, [conn, rooms]);

  const create = useCallback(() => {
    const roomName = name.trim();
    if (!roomName || !conn) return;
    void run("create", async (onStatus) => {
      onStatus("Creating the room…");
      const appId = await createRoom(conn.client, conn.source, orgId, roomName);
      conn.after();
      setRoomName(appId, roomName);
      setName("");
      setActiveRoom(appId, orgId);
      navigate("/live");
    });
  }, [name, conn, orgId, run, navigate]);

  /** "Members can create rooms": `CREATE_APP` in the org's default (owner or admin, a passkey approval). */
  const toggleMembersCreate = useCallback(
    (on: boolean) => {
      if (!conn || memberDefaults === null) return;
      void run("members-create", async (onStatus) => {
        onStatus("Approve the change with your passkey…");
        await setMembersCreateRooms(conn.client, orgId, memberDefaults, on, conn.passkey());
        conn.after();
        await load(false);
        showToast(on ? "Members can now create rooms." : "Only owners and admins can create rooms now.");
      });
    },
    [conn, memberDefaults, orgId, run, load, showToast],
  );
  const managesStream = myRole === "owner" || myRole === "admin";

  /** Open a room's call. */
  const enter = useCallback(
    (room: RoomRow) => {
      setRoomName(room.appId, room.name);
      setActiveRoom(room.appId, orgId);
      navigate("/live");
    },
    [navigate, orgId],
  );

  const mint = useCallback(
    async (onStatus: (m: string) => void, room?: RoomRow) => {
      if (!conn) throw new Error("not signed in");
      onStatus("Approve the invitation with your passkey…");
      const token = await inviteToken(conn.client, orgId, conn.passkey());
      conn.after();
      return inviteLink(token, {
        stream: orgId,
        room: room?.appId,
        name: room?.name ?? nsName,
      });
    },
    [conn, orgId, nsName],
  );

  const inviteToRoom = useCallback(
    (room: RoomRow) => {
      void run(`invite:${room.appId}`, async (onStatus) => {
        const link = await mint(onStatus, room);
        setInvite({
          key: `room:${room.appId}`,
          link,
          scope: `Opens ${room.name}`,
          hint: (
            <>
              Opening the link puts them straight into{" "}
              <strong>{room.name}</strong>. Note what it grants: joining{" "}
              <strong>{nsName}</strong>, which is what makes any room in it
              reachable — room access is inherited from the stream, so this is{" "}
              <em>not</em> narrower than the stream link. It just lands them in
              this call instead of the room list.
            </>
          ),
        });
        showToast(`Invite ready for “${room.name}”.`);
      });
    },
    [mint, nsName, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    void run("invite:namespace", async (onStatus) => {
      const link = await mint(onStatus);
      setInvite({
        key: "namespace",
        link,
        scope: `Whole stream · ${nsName}`,
        hint: (
          <>
            This link joins <strong>{nsName}</strong> and every room in it,
            including rooms made later. It lands them on the room list — to drop
            someone directly into one call, use <strong>Invite</strong> on that
            room.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [mint, nsName, run, showToast]);

  const me = conn?.accountId ?? "";
  const roomRoster = (room: RoomRow): RoomMemberLabel[] | undefined => {
    const members = rosters[room.appId];
    return members ? labelMembers(members, me, (id) => names[id]) : undefined;
  };
  const joined = (room: RoomRow) =>
    !!rosters[room.appId]?.some((m) => m.memberId === me);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark size={28} />
          <h1 className={`${styles.brandName} ${styles.hideNarrow}`}>
            Mero Stream
          </h1>
        </div>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <ChevronRightIcon size={16} className={styles.crumbSep} />
          <button
            type="button"
            className={styles.crumbLink}
            onClick={() => navigate("/streams")}
            data-testid="back-to-streams"
          >
            All streams
          </button>
          <ChevronRightIcon size={16} className={styles.crumbSep} />
          <span className={styles.crumbCurrent}>{nsName || "…"}</span>
        </nav>
        <span className={styles.spacer} />
        <div className={styles.headerActions}>
          <ActionButton
            onClick={() => void load()}
            pending={listing}
            pendingLabel="Refreshing…"
            variant="secondary"
            size="small"
            testId="refresh-rooms"
            title="Refresh the room list"
          >
            <RefreshIcon size={16} />
            <span className={styles.hideNarrow}>Refresh</span>
          </ActionButton>
          <span className={styles.headerDivider} aria-hidden="true" />
          <SessionMenu />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <h2 className={styles.title}>
              {nsName || <span className={styles.muteInline}>Loading…</span>}
            </h2>
            <p className={styles.subtitle}>
              Each <strong>room</strong> is one video call. Everyone invited to
              this stream can join any room in it — a room link just drops them
              straight into that call.
            </p>
          </div>
          <ActionButton
            onClick={inviteToNamespace}
            pending={pending === "invite:namespace"}
            pendingLabel="Minting…"
            variant="secondary"
            testId="invite-namespace"
            title="Invite someone to this whole stream (a passkey approval)"
          >
            <UserPlusIcon size={16} />
            Invite to stream
          </ActionButton>
        </div>

        {mayCreate === false ? (
          <StatusNote tone="info" testId="create-room-ask">
            {askAnOwnerCopy("a room")}
          </StatusNote>
        ) : (
          <div className={styles.toolbar}>
            <span className={styles.toolbarIcon} aria-hidden="true">
              <HashIcon size={18} />
            </span>
            <input
              className={styles.input}
              placeholder="Name a new room"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              maxLength={60}
              disabled={pending === "create"}
              data-testid="room-name-input"
              aria-label="New room name"
            />
            <ActionButton
              onClick={create}
              pending={pending === "create"}
              pendingLabel="Creating…"
              disabled={!name.trim() || !conn}
              testId="create-room"
            >
              <PlusIcon size={16} />
              Create room
            </ActionButton>
          </div>
        )}

        {managesStream && memberDefaults !== null && (
          <label className={styles.setting} title="Owners and admins can always create rooms">
            <input
              type="checkbox"
              checked={membersCreateRooms(memberDefaults)}
              disabled={pending === "members-create"}
              onChange={(e) => toggleMembersCreate(e.target.checked)}
              data-testid="members-create-rooms"
            />
            Members can create rooms
          </label>
        )}

        {status && (
          <StatusNote tone="pending" testId="rooms-status">
            {status}
          </StatusNote>
        )}
        {error && (
          <StatusNote tone="error" testId="rooms-error">
            {error}
          </StatusNote>
        )}

        <InviteModal
          open={!!invite}
          link={invite?.link ?? ""}
          scope={invite?.scope ?? ""}
          hint={invite?.hint}
          onClose={() => setInvite(null)}
        />

        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            {rooms.length} room{rooms.length === 1 ? "" : "s"}
          </h3>
          {listing && (
            <span className={styles.sectionNote}>
              <Spinner label="Loading rooms" /> loading…
            </span>
          )}
        </div>

        {!listing && rooms.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <HashIcon size={20} />
            </span>
            <span className={styles.emptyTitle}>No rooms in this stream</span>
            <span className={styles.emptyHint}>
              {mayCreate === false
                ? "An owner or admin of this stream can add one. Everyone already in the stream can join it without a new invitation."
                : "Create one above to start a call. Everyone already in the stream can join it without a new invitation."}
            </span>
          </div>
        )}

        {rooms.length > 0 && (
          <div className={styles.grid}>
            {rooms.map((room) => {
              const roster = roomRoster(room);
              const isIn = joined(room);
              return (
                <article
                  key={room.appId}
                  className={styles.card}
                  data-testid="room-row"
                  data-room={room.appId}
                  data-joined={isIn}
                >
                  <div className={styles.cardTop}>
                    <span
                      className={`${styles.avatar} ${isIn ? styles.avatarActive : ""}`}
                      aria-hidden="true"
                    >
                      <HashIcon size={18} />
                    </span>
                    <span className={styles.cardText}>
                      <span className={styles.cardName} title={room.name}>
                        {room.name}
                      </span>
                      <span className={styles.cardMeta}>
                        <span className={styles.pill}>
                          <UsersIcon size={12} />
                          {roster?.length ?? 0} member
                          {roster?.length === 1 ? "" : "s"}
                        </span>
                        {isIn ? (
                          <span className={`${styles.pill} ${styles.pillJoined}`}>
                            <span className={styles.pillDot} />
                            joined
                          </span>
                        ) : (
                          <span className={styles.pill}>not joined</span>
                        )}
                      </span>
                    </span>
                  </div>
                  {/* WHO is in the call, by the name they chose. */}
                  <span
                    className={`${styles.cardId} ${!roster?.length ? styles.cardIdMono : ""}`}
                    title={
                      roster
                        ? roster
                            .map((m) => (m.isSelf ? `${m.label} (you)` : m.label))
                            .join(", ")
                        : room.appId
                    }
                    data-testid="room-roster"
                  >
                    {roster?.length ? summariseMembers(roster) : room.appId}
                  </span>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.openBtn}
                      onClick={() => enter(room)}
                      data-testid="enter-room"
                    >
                      <VideoIcon size={16} />
                      {isIn ? "Open call" : "Join call"}
                    </button>
                    <ActionButton
                      onClick={() => inviteToRoom(room)}
                      pending={pending === `invite:${room.appId}`}
                      pendingLabel="Minting…"
                      variant="secondary"
                      size="small"
                      testId="invite-room"
                      title="Invite someone straight into this room"
                    >
                      <UserPlusIcon size={16} />
                      Invite
                    </ActionButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
