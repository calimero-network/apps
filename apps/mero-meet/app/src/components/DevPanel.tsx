import { useEffect, useRef, useState } from "react";
import type { DiagEntry, PeerStat } from "../lib/webrtc";
import styles from "./DevPanel.module.css";

interface DevPanelProps {
  diagnostics: DiagEntry[];
  getStats: () => Promise<PeerStat[]>;
  callId: string | null;
  onClose: () => void;
}

const STATS_INTERVAL_MS = 2000;

function ts(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

/**
 * Developer-mode WebRTC diagnostics. This is the ONLY surface in the whole app
 * where WebRTC internals (signaling log, peer connection state, throughput)
 * are shown. Hidden unless dev mode is on (Ctrl/Cmd+Shift+D).
 */
export default function DevPanel({ diagnostics, getStats, callId, onClose }: DevPanelProps) {
  const [stats, setStats] = useState<PeerStat[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await getStats();
      if (alive) setStats(s);
    };
    void tick();
    const id = setInterval(tick, STATS_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [getStats]);

  // Keep the log scrolled to the newest entry.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [diagnostics]);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>⚙ WebRTC diagnostics</span>
        <span className={styles.call}>{callId ?? "—"}</span>
        <button className={styles.close} onClick={onClose} title="Hide (Ctrl/Cmd+Shift+D)">
          ✕
        </button>
      </div>

      <div className={styles.peers}>
        {stats.length === 0 && <span className={styles.dim}>no peers yet</span>}
        {stats.map((p) => (
          <div key={p.peerId} className={styles.peer}>
            <span className={styles.peerId}>{p.peerId.slice(0, 8)}</span>
            <span className={`${styles.badge} ${styles[`s_${p.connection}`] ?? ""}`}>{p.connection}</span>
            <span className={styles.dim}>ice:{p.ice}</span>
            <span className={styles.kbps}>↑{p.outboundKbps} ↓{p.inboundKbps} kbps</span>
          </div>
        ))}
      </div>

      <div className={styles.log} ref={logRef}>
        {diagnostics.map((d, i) => (
          <div key={i} className={`${styles.line} ${styles[`lvl_${d.level}`] ?? ""}`}>
            <span className={styles.t}>{ts(d.t)}</span>
            <span>{d.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
