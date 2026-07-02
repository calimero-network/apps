import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@calimero-network/mero-react";
import { useMeroMeet } from "../hooks/useMeroMeet";
import { useRoomInvite } from "../hooks/useRoomInvite";
import { useCall } from "../call/CallContext";
import { getExecutorPublicKey, setRoomName, getUsername, setUsername } from "../lib/session";
import ThemeToggle from "../components/ThemeToggle";
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
  const navigate = useNavigate();
  const call = useCall();
  const selfId = getExecutorPublicKey() ?? "";

  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [username, setUsernameInput] = useState(getUsername());
  const [joined, setJoined] = useState(false);
  const invite = useRoomInvite(lobby?.room.name);

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

  // Re-register presence on a refresh: if we already have a saved name, rejoin
  // silently so the room shows us as present without re-typing (fixes "on
  // refresh I lose things").
  useEffect(() => {
    const saved = getUsername();
    if (saved && !joined) {
      void meet.join(saved).then(() => {
        setJoined(true);
        void refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates when others change presence.
  const onEvent = useCallback(() => void refresh(), [refresh]);
  useSubscription(meet.contextId ? [meet.contextId] : [], onEvent);

  const handleJoin = async () => {
    const name = username.trim() || "Guest";
    setUsername(name);
    await meet.join(name);
    setJoined(true);
    await refresh();
  };

  const enterCall = async () => {
    const name = username.trim() || "Guest";
    setUsername(name);
    if (!joined) await meet.join(name);
    call.start();
    navigate("/call");
  };

  const online = new Set(lobby?.online ?? []);
  const members: Presence[] = lobby?.members ?? [];
  // Count only members whose presence is FRESH (in the online TTL set). A member
  // who left the call clears their callId, but one who closed the window
  // ungracefully leaves callId set forever — gating on `online` drops them once
  // their heartbeat goes stale, so we stop saying "1 person in a call" when
  // nobody really is.
  const inCall = members.filter((m) => m.callId && (m.memberId === selfId || online.has(m.memberId)));
  // The call is active only if someone fresh is actually in it — not merely
  // because the active_call register still holds a stale id from an ungraceful
  // exit. This makes the room fall back to "Start call" (a fresh session) once
  // everyone has really left.
  const callActive = inCall.length > 0;
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
          <ThemeToggle />
          <button className={styles.inviteBtn} onClick={() => void invite.generate()} disabled={invite.inviting}>
            {invite.inviting ? "Inviting…" : "Invite"}
          </button>
          <button className={styles.callBtn} onClick={enterCall}>
            {callActive ? "Join call" : "Start call"}
          </button>
        </div>
      </header>

      {invite.code && (
        <div className={styles.invitePanel}>
          <div className={styles.inviteTop}>
            <span className={styles.inviteTitle}>Invite to this room</span>
            <button className={styles.copyBtn} onClick={invite.copy}>
              {invite.copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <code className={styles.inviteCode}>{invite.code}</code>
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
            onChange={(e) => setUsernameInput(e.target.value)}
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
