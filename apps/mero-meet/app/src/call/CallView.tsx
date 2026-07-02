import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCall } from "./CallContext";
import { useChat } from "../hooks/useChat";
import { useRoomInvite } from "../hooks/useRoomInvite";
import VideoTile from "../components/VideoTile";
import ChatPanel from "../components/ChatPanel";
import ThemeToggle from "../components/ThemeToggle";
import DevPanel from "../components/DevPanel";
import {
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, LeaveIcon, PeopleIcon,
  ChatIcon, InviteIcon, SparkleIcon, MinimizeIcon, ReconnectIcon,
} from "./icons";
import styles from "./CallView.module.css";

/** Grid dimensions that fit `n` tiles into the viewport with no scrolling. */
function gridDims(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export default function CallView() {
  const navigate = useNavigate();
  const call = useCall();
  const chat = useChat(true);

  const [showDev, setShowDev] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const invite = useRoomInvite(call.roomName);
  const { setPanelOpen } = chat;

  // Entering the call: if nothing is active yet (deep link or fresh open), start.
  useEffect(() => {
    if (!call.active) call.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the unread counter honest with panel visibility.
  useEffect(() => setPanelOpen(chatOpen), [chatOpen, setPanelOpen]);

  const tileCount = 1 + call.remotes.length;
  const { cols, rows } = useMemo(() => gridDims(tileCount), [tileCount]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <span className={styles.brandDot} /> {call.roomName || "Mero Meet"}
        </span>
        <div className={styles.topRight}>
          <span className={styles.count}>
            <PeopleIcon />
            {tileCount} {tileCount === 1 ? "person" : "people"}
          </span>
          {/* Diagnostics are for EVERY participant, not just desktops with
              developer mode on — debugging a call needs both sides' logs. */}
          <button
            className={styles.chip}
            onClick={() => setShowDev((v) => !v)}
            title="Call diagnostics"
          >
            ⚙
          </button>
          <ThemeToggle overlay />
        </div>
      </header>

      {call.error && (
        <div className={styles.error}>
          {call.error}
          <button className={styles.errorBtn} onClick={() => void call.leave()}>
            Back to lobby
          </button>
        </div>
      )}

      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        <VideoTile
          stream={call.localStream}
          name={call.selfName}
          isLocal
          micMuted={call.muted}
          camOff={!call.videoOn}
        />
        {call.remotes.map((r) => (
          <VideoTile
            key={r.memberId}
            stream={r.stream}
            name={r.username || r.memberId.slice(0, 6)}
            micMuted={r.muted}
            camOff={!r.videoOn}
            state={r.state}
          />
        ))}
      </div>

      {call.joining && (
        <div className={styles.joining}>
          <span className={styles.spinner} /> joining call…
        </div>
      )}

      {showInvite && (
        <div className={styles.invitePanel}>
          <div className={styles.inviteTop}>
            <span className={styles.inviteTitle}>Invite to this room</span>
            <button className={styles.inviteClose} onClick={() => setShowInvite(false)}>✕</button>
          </div>
          {invite.code ? (
            <>
              <code className={styles.inviteCode}>{invite.code}</code>
              <button className={styles.copyBtn} onClick={invite.copy}>
                {invite.copied ? "Copied ✓" : "Copy code"}
              </button>
              <span className={styles.inviteHint}>
                They open Mero Meet → <strong>Join</strong> and paste it.
              </span>
            </>
          ) : (
            <button className={styles.copyBtn} onClick={() => void invite.generate()} disabled={invite.inviting}>
              {invite.inviting ? "Generating…" : "Generate invite code"}
            </button>
          )}
        </div>
      )}

      {chatOpen && chat.supported && (
        <ChatPanel
          messages={chat.messages}
          selfId={chat.selfId}
          onSend={(t) => void chat.send(t)}
          onClose={() => setChatOpen(false)}
        />
      )}

      {showDev && (
        <DevPanel
          diagnostics={call.diagnostics}
          getStats={call.getStats}
          callId={call.callId}
          effect={call.effect}
          remoteCount={call.remotes.length}
          onClose={() => setShowDev(false)}
        />
      )}

      <div className={styles.controls}>
        <div className={styles.dock}>
          <button
            className={`${styles.ctrl} ${call.muted ? styles.ctrlOff : ""}`}
            onClick={call.toggleMute}
            title={call.muted ? "Unmute" : "Mute"}
            aria-label={call.muted ? "Unmute" : "Mute"}
          >
            {call.muted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            className={`${styles.ctrl} ${!call.videoOn ? styles.ctrlOff : ""}`}
            onClick={call.toggleVideo}
            title={call.videoOn ? "Stop video" : "Start video"}
            aria-label={call.videoOn ? "Stop video" : "Start video"}
          >
            {call.videoOn ? <VideoIcon /> : <VideoOffIcon />}
          </button>

          <div className={styles.popWrap}>
            <button
              className={`${styles.ctrl} ${call.effect !== "none" ? styles.ctrlActive : ""}`}
              onClick={() => setShowEffects((v) => !v)}
              title="Background effects"
              aria-label="Background effects"
              disabled={call.effectBusy}
            >
              <SparkleIcon />
            </button>
            {showEffects && (
              <div className={styles.pop}>
                <span className={styles.popTitle}>Background</span>
                <button
                  className={`${styles.popItem} ${call.effect === "none" ? styles.popSel : ""}`}
                  onClick={() => { call.setEffect("none"); setShowEffects(false); }}
                >
                  None
                </button>
                <button
                  className={`${styles.popItem} ${call.effect === "blur" ? styles.popSel : ""}`}
                  onClick={() => { call.setEffect("blur"); setShowEffects(false); }}
                >
                  Blur {call.effectBusy && call.effect !== "blur" ? "…" : ""}
                </button>
              </div>
            )}
          </div>

          {/* Hidden while the room's contract predates the chat methods. */}
          {chat.supported && (
            <button
              className={`${styles.ctrl} ${chatOpen ? styles.ctrlActive : ""}`}
              onClick={() => setChatOpen((v) => !v)}
              title="Chat"
              aria-label="Chat"
            >
              <ChatIcon />
              {chat.unread > 0 && !chatOpen && <span className={styles.badge}>{chat.unread}</span>}
            </button>
          )}
          <button
            className={`${styles.ctrl} ${showInvite ? styles.ctrlActive : ""}`}
            onClick={() => setShowInvite((v) => !v)}
            title="Invite people"
            aria-label="Invite people"
          >
            <InviteIcon />
          </button>
          <button
            className={styles.ctrl}
            onClick={call.reconnect}
            title="Reconnect (rebuild all connections)"
            aria-label="Reconnect"
          >
            <ReconnectIcon />
          </button>
          <button
            className={styles.ctrl}
            onClick={() => navigate("/lobby")}
            title="Minimize"
            aria-label="Minimize call"
          >
            <MinimizeIcon />
          </button>
          <button
            className={`${styles.ctrl} ${styles.leave}`}
            onClick={() => void call.leave()}
            title="Leave call"
            aria-label="Leave call"
          >
            <LeaveIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
