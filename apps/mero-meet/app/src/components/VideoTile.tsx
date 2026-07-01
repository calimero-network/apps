import { useEffect, useRef } from "react";
import styles from "./VideoTile.module.css";

interface VideoTileProps {
  stream: MediaStream | null;
  /** Display name (never a raw id — callers resolve it from presence). */
  name: string;
  isLocal?: boolean;
  /** Show the mic-muted badge. */
  micMuted?: boolean;
  /** Camera is off — show the avatar instead of video. */
  camOff?: boolean;
  /** Connection state for remote tiles (shows a "connecting…" overlay). */
  state?: RTCPeerConnectionState;
  /** Mirror horizontally. Defaults to true for the local tile (natural selfie
   *  view), false for remotes (mirroring someone else is disorienting). */
  mirror?: boolean;
  /** Compact styling for the mini-call / small tiles. */
  compact?: boolean;
}

const MicOffBadge = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 9v-4a3 3 0 0 1 6 0v4M9 14a3 3 0 0 0 5.12 1.88" />
    <path d="M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.3 2" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </svg>
);

/** A single video pane bound to a MediaStream. */
export default function VideoTile({
  stream,
  name,
  isLocal,
  micMuted,
  camOff,
  state,
  mirror,
  compact,
}: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const connecting = !isLocal && state !== "connected" && state !== undefined;
  const streamHasVideo = stream?.getVideoTracks().some((t) => t.enabled) ?? false;
  const showVideo = streamHasVideo && !camOff;
  const doMirror = mirror ?? Boolean(isLocal);

  return (
    <div className={`${styles.tile} ${compact ? styles.compact : ""}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isLocal}
        className={styles.video}
        style={{
          transform: doMirror ? "scaleX(-1)" : undefined,
          visibility: showVideo ? "visible" : "hidden",
        }}
      />
      {!showVideo && (
        <div className={styles.avatar}>
          <span>{(name || "?").slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      {connecting && <div className={styles.overlay}>connecting…</div>}
      <div className={styles.label}>
        {micMuted && (
          <span className={styles.micOff} title="Muted">
            <MicOffBadge />
          </span>
        )}
        <span className={styles.name}>
          {name}
          {isLocal ? " (you)" : ""}
        </span>
      </div>
    </div>
  );
}
