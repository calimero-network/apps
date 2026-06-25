import { useEffect, useRef } from "react";
import styles from "./VideoTile.module.css";

interface VideoTileProps {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  isLocal?: boolean;
  /** Connection state for remote tiles (shows a "connecting…" overlay). */
  state?: RTCPeerConnectionState;
}

/** A single video pane bound to a MediaStream. */
export default function VideoTile({ stream, label, muted, isLocal, state }: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const connecting = !isLocal && state !== "connected" && state !== undefined;
  const hasVideo = stream?.getVideoTracks().some((t) => t.enabled);

  return (
    <div className={styles.tile}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted || isLocal}
        className={styles.video}
      />
      {!hasVideo && (
        <div className={styles.avatar}>
          <span>{label.slice(0, 2).toUpperCase()}</span>
        </div>
      )}
      {connecting && <div className={styles.overlay}>connecting…</div>}
      <div className={styles.label}>
        {label}
        {isLocal ? " (you)" : ""}
      </div>
    </div>
  );
}
