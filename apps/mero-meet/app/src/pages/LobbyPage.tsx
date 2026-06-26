import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSubscription, useMero } from "@calimero-network/mero-react";
import { useMeroMeet } from "../hooks/useMeroMeet";
import { getExecutorPublicKey, setRoomName } from "../lib/session";
import { encodeInvitationObject } from "../lib/invitation";
import type { LobbyView, Presence } from "../types";
import styles from "./LobbyPage.module.css";

const REFRESH_MS = 4000;
const HEARTBEAT_MS = 10_000;

/**
 * The lobby = the room directory. Shows everyone who's in this Calimero room
 * (presence), who's online, and who is already in a call — then lets you join.
 * "Finding people" is exactly this presence list.
 */
export default function LobbyPage() {
  const meet = useMeroMeet();
  const { mero } = useMero();
  const navigate = useNavigate();
  const selfId = getExecutorPublicKey() ?? "";

  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const view = await meet.getLobby();
    if (view) {
      setLobby(view);
      // Cache the room's name so the Rooms picker shows it (not a raw id).
      if (meet.contextId && view.room.name) setRoomName(meet.contextId, view.room.name);
    }
  }, [meet]);

  // Initial join + presence refresh loop + heartbeat.
  useEffect(() => {
    void refresh();
    const r = setInterval(() => void refresh(), REFRESH_MS);
    const hb = setInterval(() => {
      if (joined) void meet.heartbeat();
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(r);
      clearInterval(hb);
    };
  }, [refresh, meet, joined]);

  // Live updates when others change presence.
  const onEvent = useCallback(() => void refresh(), [refresh]);
  useSubscription(meet.contextId ? [meet.contextId] : [], onEvent);

  const handleJoin = async () => {
    const name = username.trim() || "Guest";
    await meet.join(name);
    setJoined(true);
    await refresh();
  };

  const enterCall = async () => {
    if (!joined) await meet.join(username.trim() || "Guest");
    navigate("/call");
  };

  // Invite = a namespace invitation for this room (same flow as the other mero
  // apps): resolve the room's namespace, mint a signed invitation, ship it as a
  // url-safe token the invitee pastes into "Join" on the Rooms screen.
  const makeInvite = async () => {
    if (!mero || !meet.contextId || inviting) return;
    setInviting(true);
    try {
      const namespaceId = await mero.admin.getContextGroup(meet.contextId);
      if (!namespaceId) throw new Error("no namespace for this room");
      const inv = await mero.admin.createNamespaceInvitation(namespaceId);
      const code = encodeInvitationObject({
        ...(inv as unknown as Record<string, unknown>),
        __roomName: lobby?.room.name ?? "",
      });
      setInviteCode(code);
      setCopied(false);
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
      } catch {/* clipboard blocked — user can still copy from the box */}
    } catch {
      setInviteCode("");
    } finally {
      setInviting(false);
    }
  };

  const online = new Set(lobby?.online ?? []);
  const members: Presence[] = lobby?.members ?? [];
  const callActive = (lobby?.room.activeCall ?? "") !== "";
  const inCall = members.filter((m) => m.callId);
  // Count online with the same self-override the rows use, so the header never
  // says "0 online" while you're sitting in the room.
  const onlineCount = members.filter((m) => m.memberId === selfId || online.has(m.memberId)).length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <button className={styles.switchBtn} onClick={() => navigate("/rooms")}>
            ← All rooms
          </button>
          <h1 className={styles.roomName}>{lobby?.room.name || "Room"}</h1>
          <p className={styles.roomMeta}>
            {onlineCount} online · {Math.max(lobby?.room.memberCount ?? 0, members.length)} members
            {callActive && <span className={styles.liveDot}> · call in progress</span>}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.inviteBtn} onClick={makeInvite} disabled={inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </button>
          <button className={styles.callBtn} onClick={enterCall}>
            {callActive ? "Join call" : "Start call"}
          </button>
        </div>
      </header>

      {inviteCode && (
        <div className={styles.invitePanel}>
          <div className={styles.inviteTop}>
            <span className={styles.inviteTitle}>Invite to this room</span>
            <button
              className={styles.copyBtn}
              onClick={() => {
                void navigator.clipboard.writeText(inviteCode);
                setCopied(true);
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <code className={styles.inviteCode}>{inviteCode}</code>
          <span className={styles.inviteHint}>
            Share this code. They open Mero Meet → <strong>Join</strong> and paste it.
          </span>
        </div>
      )}

      {!joined && (
        <div className={styles.joinBar}>
          <input
            className={styles.input}
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            maxLength={40}
          />
          <button className={styles.joinBtn} onClick={handleJoin}>
            Enter room
          </button>
        </div>
      )}

      {callActive && (
        <section className={styles.callBanner}>
          <span className={styles.pulse} />
          <span>
            {inCall.length} {inCall.length === 1 ? "person is" : "people are"} in a call
          </span>
          <button className={styles.bannerJoin} onClick={enterCall}>
            Join
          </button>
        </section>
      )}

      <section className={styles.list}>
        <h2 className={styles.listTitle}>People</h2>
        {members.length === 0 && <p className={styles.empty}>No one here yet. Be the first.</p>}
        {members.map((m) => {
          const isSelf = m.memberId === selfId;
          // You're looking at the app right now, so always show yourself online —
          // don't wait on the presence-TTL heartbeat to mark self online.
          const isOnline = isSelf || online.has(m.memberId);
          return (
            <div key={m.memberId} className={styles.row}>
              <span className={`${styles.status} ${isOnline ? styles.on : styles.off}`} />
              <span className={styles.avatar}>{m.username.slice(0, 2).toUpperCase()}</span>
              <div className={styles.who}>
                <span className={styles.name}>
                  {m.username}
                  {isSelf && <span className={styles.youTag}> you</span>}
                </span>
                <span className={styles.sub}>
                  {m.callId ? "in call" : isOnline ? "available" : "away"}
                  {m.muted && " · muted"}
                  {!m.videoOn && " · camera off"}
                </span>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
