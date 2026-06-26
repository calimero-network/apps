import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCall } from "../hooks/useCall";
import VideoTile from "../components/VideoTile";
import DevPanel from "../components/DevPanel";
import { isDevMode } from "../lib/dev";
import styles from "./CallPage.module.css";

/* ── Inline icons (stroke = currentColor) ─────────────────────────────────── */
const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </svg>
);
const MicOffIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 9v-4a3 3 0 0 1 6 0v4M9 14a3 3 0 0 0 5.12 1.88" />
    <path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.3 2" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </svg>
);
const VideoIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="14" height="12" rx="2.5" />
    <path d="M22 8.5 16 12l6 3.5z" />
  </svg>
);
const VideoOffIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 16H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M10 6h4a2 2 0 0 1 2 2v2" />
    <path d="M22 8.5 16 12" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </svg>
);
const LeaveIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none">
    <path d="M12 9c-1.6 0-3.15.25-4.6.7v3.1c0 .4-.24.74-.6.9-1.05.45-2 1.05-2.85 1.75-.18.16-.43.25-.68.25-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.71c0-.28.11-.53.29-.71C2.85 9.18 7.18 7.5 12 7.5s9.15 1.68 11.71 4.16c.18.18.29.43.29.71s-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.25 0-.5-.09-.68-.24a11.27 11.27 0 0 0-2.85-1.76c-.36-.16-.6-.5-.6-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
  </svg>
);
const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
    <circle cx="10" cy="8" r="3.2" />
    <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15 5.2a3.2 3.2 0 0 1 0 6" />
  </svg>
);

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
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <span className={styles.brandDot} /> Mero Meet
        </span>
        <span className={styles.count}>
          <PeopleIcon />
          {tileCount} {tileCount === 1 ? "person" : "people"}
        </span>
      </header>

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

      {call.joining && (
        <div className={styles.joining}>
          <span className={styles.spinner} /> joining call…
        </div>
      )}

      {showDev && (
        <DevPanel
          diagnostics={call.diagnostics}
          getStats={call.getStats}
          callId={call.callId}
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
