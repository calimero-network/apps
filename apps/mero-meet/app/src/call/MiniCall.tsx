import { useCallback, useRef, useState } from "react";
import VideoTile from "../components/VideoTile";
import { useCall } from "./CallContext";
import { MicIcon, MicOffIcon, LeaveIcon, ExpandIcon, PeopleIcon } from "./icons";
import styles from "./MiniCall.module.css";

/**
 * The floating, draggable mini-call shown when you navigate away from the full
 * call screen while a call is live. Click it (or the expand button) to return.
 */
export default function MiniCall({ onExpand }: { onExpand: () => void }) {
  const call = useCall();
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Feature the first connected remote if there is one; otherwise show yourself.
  const featured = call.remotes.find((r) => r.stream) ?? call.remotes[0];
  const count = 1 + call.remotes.length;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget.parentElement as HTMLElement;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = 232;
    const h = 168;
    const x = Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - w - 8);
    const y = Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - h - 8);
    setPos({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const style =
    pos.x < 0 ? undefined : { left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto" };

  return (
    <div className={styles.mini} style={style}>
      <div
        className={styles.dragHandle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={styles.count}>
          <PeopleIcon /> {count}
        </span>
        <button className={styles.iconBtn} onClick={onExpand} title="Expand call" aria-label="Expand call">
          <ExpandIcon />
        </button>
      </div>

      <button className={styles.stage} onClick={onExpand} title="Return to call">
        {featured ? (
          <VideoTile
            stream={featured.stream}
            name={featured.username || featured.memberId.slice(0, 6)}
            camOff={!featured.videoOn}
            micMuted={featured.muted}
            state={featured.state}
            mirror={false}
            compact
          />
        ) : (
          <VideoTile stream={call.localStream} name={call.selfName} isLocal camOff={!call.videoOn} compact />
        )}
      </button>

      <div className={styles.bar}>
        <button
          className={`${styles.ctrl} ${call.muted ? styles.off : ""}`}
          onClick={call.toggleMute}
          title={call.muted ? "Unmute" : "Mute"}
          aria-label={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? <MicOffIcon /> : <MicIcon />}
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
  );
}
