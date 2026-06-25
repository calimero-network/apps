import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCall } from "../hooks/useCall";
import VideoTile from "../components/VideoTile";
import DevPanel from "../components/DevPanel";
import { isDevMode } from "../lib/dev";
import styles from "./CallPage.module.css";

/** The active call: a grid of video tiles + the control bar. */
export default function CallPage() {
  const navigate = useNavigate();
  const call = useCall(() => navigate("/lobby"));

  // Developer mode comes from the desktop app's Settings → Developer mode
  // (forwarded via the URL hash). It's the ONLY place WebRTC internals surface.
  // The close button just dismisses the overlay for this session.
  const [showDev, setShowDev] = useState(isDevMode());

  const tileCount = 1 + call.remotes.length;
  const gridClass =
    tileCount <= 1 ? styles.grid1 : tileCount <= 2 ? styles.grid2 : tileCount <= 4 ? styles.grid4 : styles.gridMany;

  return (
    <div className={styles.page}>
      {call.error && (
        <div className={styles.error}>
          {call.error}
          <button className={styles.errorBtn} onClick={() => navigate("/lobby")}>
            Back to lobby
          </button>
        </div>
      )}

      <div className={`${styles.grid} ${gridClass}`}>
        <VideoTile stream={call.localStream} label="You" isLocal muted />
        {call.remotes.map((r) => (
          <VideoTile
            key={r.memberId}
            stream={r.stream}
            label={r.memberId.slice(0, 6)}
            state={r.state}
          />
        ))}
      </div>

      {call.joining && <div className={styles.joining}>joining call…</div>}

      {showDev && (
        <DevPanel
          diagnostics={call.diagnostics}
          getStats={call.getStats}
          callId={call.callId}
          onClose={() => setShowDev(false)}
        />
      )}

      <div className={styles.controls}>
        <button
          className={`${styles.ctrl} ${call.muted ? styles.ctrlOff : ""}`}
          onClick={call.toggleMute}
          title={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? "🔇" : "🎤"}
          <span className={styles.ctrlLabel}>{call.muted ? "Unmute" : "Mute"}</span>
        </button>
        <button
          className={`${styles.ctrl} ${!call.videoOn ? styles.ctrlOff : ""}`}
          onClick={call.toggleVideo}
          title={call.videoOn ? "Stop video" : "Start video"}
        >
          {call.videoOn ? "📹" : "🚫"}
          <span className={styles.ctrlLabel}>{call.videoOn ? "Camera" : "Camera off"}</span>
        </button>
        <button className={`${styles.ctrl} ${styles.leave}`} onClick={() => void call.leave()} title="Leave">
          📴
          <span className={styles.ctrlLabel}>Leave</span>
        </button>
      </div>
    </div>
  );
}
