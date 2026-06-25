import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@calimero-network/mero-react";
import { useMeroMeet } from "../hooks/useMeroMeet";
import { getExecutorPublicKey } from "../lib/session";
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
  const selfId = getExecutorPublicKey() ?? "";

  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);

  const refresh = useCallback(async () => {
    const view = await meet.getLobby();
    if (view) setLobby(view);
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

  const online = new Set(lobby?.online ?? []);
  const members: Presence[] = lobby?.members ?? [];
  const callActive = (lobby?.room.activeCall ?? "") !== "";
  const inCall = members.filter((m) => m.callId);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.roomName}>{lobby?.room.name || "Room"}</h1>
          <p className={styles.roomMeta}>
            {lobby?.room.onlineCount ?? 0} online · {lobby?.room.memberCount ?? 0} members
            {callActive && <span className={styles.liveDot}> · call in progress</span>}
          </p>
        </div>
        <button className={styles.callBtn} onClick={enterCall}>
          {callActive ? "Join call" : "Start call"}
        </button>
      </header>

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
          const isOnline = online.has(m.memberId);
          const isSelf = m.memberId === selfId;
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
