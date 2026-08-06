import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { getApplicationId, setActiveRoom, setRoomName } from "../lib/session";
import {
  createRoom,
  enterRoomContext,
  listRooms,
  mintNamespaceInvite,
  mintRoomInvite,
  type RoomRow,
} from "../lib/groups";
import { ActionButton, InviteBox, StatusNote, Spinner } from "../components/ui";
import styles from "./StreamsPage.module.css";

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
  const { mero, applicationId: providerAppId } = useMero();
  const appId = getApplicationId() ?? providerAppId ?? "";

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [listing, setListing] = useState(true);
  const [nsName, setNsName] = useState("");
  const [name, setName] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    key: string;
    code: string;
    scope: string;
    hint: React.ReactNode;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(
    async (
      key: string,
      fn: (onStatus: (m: string) => void) => Promise<void>,
    ) => {
      setPending(key);
      setError(null);
      setDone(null);
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
      setActiveRoom(contextId, memberPublicKey);
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
        setActiveRoom(contextId, identity);
        navigate("/live");
      });
    },
    [mero, run, navigate],
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
        setCopied(false);
        setDone(`Invite code ready for “${room.name}”.`);
      });
    },
    [mero, namespaceId, nsName, run],
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
      setCopied(false);
      setDone(`Invite code ready for “${nsName}”.`);
    });
  }, [mero, namespaceId, nsName, run]);

  const copy = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      setError("Could not reach the clipboard — select the code and copy it.");
    }
  }, [invite]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate("/streams")}
          data-testid="back-to-streams"
        >
          ← All streams
        </button>
        <h1 className={styles.title}>
          {nsName || <span className={styles.muteInline}>Loading…</span>}
        </h1>
        <p className={styles.subtitle}>
          Each room is one video call. Everyone invited to this stream can join
          any room in it — a room code just drops them straight into that call.
        </p>
      </header>

      <section className={styles.createBar}>
        <input
          className={styles.input}
          placeholder="New room name"
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
      </section>

      <section className={styles.actionBar}>
        <ActionButton
          onClick={inviteToNamespace}
          pending={pending === "invite:namespace"}
          pendingLabel="Minting…"
          variant="secondary"
          size="small"
          testId="invite-namespace"
          title="Mint a code that invites someone to this whole stream"
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
      </section>

      {status && (
        <StatusNote tone="pending" testId="rooms-status">
          {status}
        </StatusNote>
      )}
      {!status && done && (
        <StatusNote tone="ok" testId="rooms-done">
          {done}
        </StatusNote>
      )}
      {error && (
        <StatusNote tone="error" testId="rooms-error">
          {error}
        </StatusNote>
      )}

      {invite && (
        <InviteBox
          code={invite.code}
          scope={invite.scope}
          hint={invite.hint}
          copied={copied}
          onCopy={() => void copy()}
        />
      )}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>
          Rooms
          {listing && (
            <span className={styles.listLoading}>
              <Spinner label="Loading rooms" /> loading…
            </span>
          )}
        </h2>

        {!listing && rooms.length === 0 && (
          <p className={styles.muted}>
            No rooms in this stream yet. Create one above to start a call.
          </p>
        )}

        {rooms.map((room) => (
          <div key={room.roomId} className={styles.rowWrap}>
            <button
              className={styles.row}
              onClick={() => enter(room)}
              disabled={pending === `enter:${room.roomId}`}
              data-testid="room-row"
              data-room={room.roomId}
              data-joined={room.joined}
            >
              <span className={styles.streamAvatar}>
                {room.name.slice(0, 2).toUpperCase()}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{room.name}</span>
                <span className={styles.rowMeta}>
                  {room.memberCount} member{room.memberCount === 1 ? "" : "s"}
                  {room.contextId
                    ? room.joined
                      ? " · you are in this room"
                      : " · not joined yet"
                    : " · waiting for the context to replicate"}
                </span>
              </span>
              <span className={styles.enter}>
                {pending === `enter:${room.roomId}` ? (
                  <>
                    <Spinner label="Joining" /> joining…
                  </>
                ) : room.joined ? (
                  "Open →"
                ) : (
                  "Join →"
                )}
              </span>
            </button>
            <ActionButton
              onClick={() => inviteToRoom(room)}
              pending={pending === `invite:${room.roomId}`}
              pendingLabel="Minting…"
              variant="secondary"
              testId="invite-room"
              title="Mint a code that invites someone to this room only"
            >
              Invite
            </ActionButton>
          </div>
        ))}
      </section>
    </div>
  );
}
