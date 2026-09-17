import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveRoom, setRoomName } from "../lib/session";
import {
  createRoom,
  enterRoomContext,
  listRooms,
  mintNamespaceInvite,
  mintRoomInvite,
  type RoomRow,
} from "../lib/groups";
import { ActionButton, StatusNote, Spinner } from "../components/ui";
import InviteModal from "../components/InviteModal";
import SessionMenu from "../components/SessionMenu";
import { initials } from "../lib/people";
import { labelMembers, summariseMembers, type RoomMemberLabel } from "../lib/roomMembers";
import type { Member } from "../types";
import styles from "./Manage.module.css";

/**
 * Rooms inside one stream (namespace). A room is a SUBGROUP plus the context bound
 * to it, and that context is the video call.
 *
 * The two things this page exists to make possible, both proven by suite S3/S4:
 *
 *   - A namespace can hold MORE THAN ONE call. The old picker created a namespace
 *     and a single context together, so it could not.
 *   - A room is joinable by someone who only holds the namespace, because it is
 *     created OPEN. Restricted is the default, and a restricted room answers
 *     `join-via-inheritance` with 403 — invited members could see the stream and
 *     never reach the call.
 *
 * Two invite scopes are offered, and the difference is DESTINATION, not grant:
 * both codes join the stream (room access is inherited from it, so there is no
 * narrower grant to hand out — see `mintRoomInvite`), but a room code drops the
 * joiner straight into that call while a stream code leaves them on this list. The
 * hints say so rather than implying the room code is more restrictive.
 */
export default function RoomsPage() {
  const navigate = useNavigate();
  const { namespaceId = "" } = useParams();
  const { mero } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  /** Contract roster per room context, so rows can show WHO is in a call. */
  const [rosters, setRosters] = useState<Record<string, RoomMemberLabel[]>>({});
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
        // The namespace's own name for the header, so the page says which stream
        // you are in rather than a truncated id.
        const info = await mero.admin
          .getNamespace(namespaceId)
          .catch(() => null);
        setNsName(
          (info?.name ?? "").trim() || `Stream ${namespaceId.slice(0, 6)}`,
        );
        setRooms(await listRooms(mero.admin, namespaceId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load rooms.");
      } finally {
        setListing(false);
      }
    },
    [mero, namespaceId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Read each joined room's contract roster, so a row can say WHO is in the
   * call rather than only how many.
   *
   * Only rooms this node has joined: `execute` against a context we hold no
   * identity in is refused, and firing those would put one guaranteed error per
   * un-joined room into the console on every load.
   *
   * Failures are dropped silently and per room — a roster is an enrichment, and
   * one unreachable context should not cost the other rooms their names or turn
   * the page into an error state.
   */
  useEffect(() => {
    if (!mero) return;
    const joined = rooms.filter((r) => r.joined && r.contextId);
    if (joined.length === 0) return;
    let cancelled = false;
    void Promise.all(
      joined.map(async (room) => {
        try {
          const members = await mero.rpc.execute<Member[]>({
            contextId: room.contextId!,
            method: "get_members",
            argsJson: {},
          });
          return [
            room.contextId!,
            labelMembers(members ?? [], room.identity ?? ""),
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, RoomMemberLabel[]> = {};
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      setRosters(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mero, rooms]);

  const create = useCallback(() => {
    const roomName = name.trim();
    if (!roomName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Stream from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { contextId, memberPublicKey } = await createRoom(
        mero.admin,
        { applicationId: appId, namespaceId, name: roomName },
        onStatus,
      );
      setRoomName(contextId, roomName);
      setName("");
      setActiveRoom(contextId, memberPublicKey, namespaceId);
      // Into the call: the creator is already a member, so there is nothing to wait
      // for. 480p H.264 (/live), not the 64x48 in-WASM comparison route.
      navigate("/live");
    });
  }, [name, mero, appId, namespaceId, run, navigate]);

  /** Enter a room: join it if needed, wait for the identity, then open the call. */
  const enter = useCallback(
    (room: RoomRow) => {
      if (!mero) return;
      if (!room.contextId) {
        setError(
          `“${room.name}” has no call context on this node yet. It may still be replicating — refresh in a moment.`,
        );
        return;
      }
      const contextId = room.contextId;
      void run(`enter:${room.roomId}`, async (onStatus) => {
        const identity = await enterRoomContext(
          mero.admin,
          { roomId: room.roomId, contextId },
          onStatus,
        );
        setRoomName(contextId, room.name);
        setActiveRoom(contextId, identity, namespaceId);
        navigate("/live");
      });
    },
    [mero, run, navigate, namespaceId],
  );

  const inviteToRoom = useCallback(
    (room: RoomRow) => {
      if (!mero) return;
      void run(`invite:${room.roomId}`, async (onStatus) => {
        const code = await mintRoomInvite(
          mero.admin,
          {
            namespaceId,
            roomId: room.roomId,
            roomName: room.name,
            namespaceName: nsName,
            contextId: room.contextId,
          },
          onStatus,
        );
        setInvite({
          key: `room:${room.roomId}`,
          code,
          scope: `Opens ${room.name}`,
          hint: (
            <>
              One paste puts them straight into <strong>{room.name}</strong>.
              Note what it grants: joining <strong>{nsName}</strong>, which is
              what makes any room in it reachable — room access is inherited
              from the stream, so this is <em>not</em> narrower than the stream
              code. It just lands them in this call instead of the room list.
            </>
          ),
        });
        showToast(`Invite ready for “${room.name}”.`);
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
        scope: `Whole stream · ${nsName}`,
        hint: (
          <>
            This code joins <strong>{nsName}</strong> and every room in it,
            including rooms made later. It lands them on the room list — to drop
            someone directly into one call, use <strong>Invite</strong> on that
            room.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [mero, namespaceId, nsName, run, showToast]);

  /** This room's labelled roster, or undefined when we do not have one. */
  const roomRoster = (room: RoomRow): RoomMemberLabel[] | undefined =>
    room.contextId ? rosters[room.contextId] : undefined;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>Mero Stream</h1>
        </div>
        <span className={styles.spacer} />
        <ActionButton
          onClick={inviteToNamespace}
          pending={pending === "invite:namespace"}
          pendingLabel="Minting…"
          variant="secondary"
          size="small"
          testId="invite-namespace"
          title="Invite someone to this whole stream"
        >
          Invite to stream
        </ActionButton>
        <ActionButton
          onClick={() => void load()}
          pending={listing}
          pendingLabel="Refreshing…"
          variant="secondary"
          size="small"
          testId="refresh-rooms"
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
            onClick={() => navigate("/streams")}
            data-testid="back-to-streams"
          >
            All streams
          </button>
          <span aria-hidden="true">/</span>
          <span>{nsName || "…"}</span>
        </nav>

        <div className={styles.heading}>
          <h2 className={styles.title}>
            {nsName || <span className={styles.muteInline}>Loading…</span>}
          </h2>
          <p className={styles.subtitle}>
            Each <strong>room</strong> is one video call. Everyone invited to
            this stream can join any room in it — a room link just drops them
            straight into that call.
          </p>
        </div>

        <div className={styles.toolbar}>
          <input
            className={styles.input}
            placeholder="Name a new room"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={60}
            disabled={pending === "create"}
            data-testid="room-name-input"
          />
          <ActionButton
            onClick={create}
            pending={pending === "create"}
            pendingLabel="Creating…"
            disabled={!name.trim() || !mero}
            testId="create-room"
          >
            Create room
          </ActionButton>
        </div>

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
          code={invite?.code ?? ""}
          scope={invite?.scope ?? ""}
          hint={invite?.hint}
          onClose={() => setInvite(null)}
        />

        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            {rooms.length} room{rooms.length === 1 ? "" : "s"}
          </h3>
          {(listing || resolvingAppId) && (
            <span className={styles.sectionNote}>
              <Spinner label="Loading rooms" /> loading…
            </span>
          )}
        </div>

        {notInstalled && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              Mero Stream is not installed on this node
            </span>
            <span className={styles.emptyHint}>
              Install it from the marketplace, then reload.
            </span>
          </div>
        )}

        {!listing && !resolvingAppId && !notInstalled && rooms.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>No rooms in this stream</span>
            <span className={styles.emptyHint}>
              Create one above to start a call. Everyone already in the stream
              can join it without a new invitation.
            </span>
          </div>
        )}

        {rooms.length > 0 && (
          <div className={styles.grid}>
            {rooms.map((room) => (
              <article
                key={room.roomId}
                className={styles.card}
                data-testid="room-row"
                data-room={room.roomId}
                data-joined={room.joined}
              >
                <div className={styles.cardTop}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(room.name)}
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName} title={room.name}>
                      {room.name}
                    </span>
                    <span className={styles.cardMeta}>
                      <span className={styles.pill}>
                        {room.memberCount} member
                        {room.memberCount === 1 ? "" : "s"}
                      </span>
                      {/* Three distinct states, and the third is not a failure:
                          a room whose context has not replicated to this node
                          yet cannot be entered, and saying so beats a button
                          that does nothing. */}
                      {!room.contextId ? (
                        <span
                          className={`${styles.pill} ${styles.pillWaiting}`}
                        >
                          syncing
                        </span>
                      ) : room.joined ? (
                        <span className={`${styles.pill} ${styles.pillJoined}`}>
                          joined
                        </span>
                      ) : (
                        <span className={styles.pill}>not joined</span>
                      )}
                    </span>
                  </span>
                </div>
                {/* WHO is in the call, by the name they chose — not the raw
                    context id, which answers no question anyone has. Falls
                    back to the id only while the roster is unknown (not
                    joined, or still loading). */}
                <span
                  className={styles.cardId}
                  title={
                    roomRoster(room)
                      ? roomRoster(room)!
                          .map((m) => (m.isSelf ? `${m.label} (you)` : m.label))
                          .join(", ")
                      : (room.contextId ?? "")
                  }
                  data-testid="room-roster"
                >
                  {roomRoster(room)?.length
                    ? summariseMembers(roomRoster(room)!)
                    : (room.contextId ?? "waiting for the context to replicate")}
                </span>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.openBtn}
                    onClick={() => enter(room)}
                    data-testid="enter-room"
                    disabled={
                      pending === `enter:${room.roomId}` || !room.contextId
                    }
                  >
                    {pending === `enter:${room.roomId}` ? (
                      <>
                        <Spinner label="Joining" /> joining…
                      </>
                    ) : room.joined ? (
                      "Open call"
                    ) : (
                      "Join call"
                    )}
                  </button>
                  <ActionButton
                    onClick={() => inviteToRoom(room)}
                    pending={pending === `invite:${room.roomId}`}
                    pendingLabel="Minting…"
                    variant="secondary"
                    testId="invite-room"
                    title="Invite someone straight into this room"
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
