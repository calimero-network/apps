import { useEffect, useMemo, useRef, useState } from "react";
import type { DiagEntry, PeerStat } from "../lib/webrtc";
import styles from "./DevPanel.module.css";

interface DevPanelProps {
  diagnostics: DiagEntry[];
  getStats: () => Promise<PeerStat[]>;
  callId: string | null;
  onClose: () => void;
  /** Extra context shown in the summary row. */
  effect?: string;
  remoteCount?: number;
}

const STATS_INTERVAL_MS = 2000;
const LEVELS: DiagEntry["level"][] = ["info", "signal", "peer", "error"];

function ts(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

/**
 * Developer-mode WebRTC diagnostics — the only surface where WebRTC internals
 * (signaling log, peer state, throughput, roster/effect events) are shown. It is
 * closable (✕) and re-openable from the ⚙ button in the call top bar. Filter by
 * level, copy the whole log, or clear the view.
 */
export default function DevPanel({ diagnostics, getStats, callId, onClose, effect, remoteCount }: DevPanelProps) {
  const [stats, setStats] = useState<PeerStat[]>([]);
  const [enabled, setEnabled] = useState<Set<DiagEntry["level"]>>(new Set(LEVELS));
  const [copied, setCopied] = useState(false);
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

  const shown = useMemo(() => diagnostics.filter((d) => enabled.has(d.level)), [diagnostics, enabled]);

  // Keep the log scrolled to the newest entry.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const toggleLevel = (lvl: DiagEntry["level"]) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  const copyLog = async () => {
    // Stamp the build version so pasted bug reports say which build broke.
    const text = [`mero-meet v${__APP_VERSION__}`]
      .concat(diagnostics.map((d) => `${ts(d.t)} [${d.level}] ${d.msg}`))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>⚙ WebRTC diagnostics</span>
        <span className={styles.call}>v{__APP_VERSION__} · {callId ?? "—"}</span>
        <button className={styles.close} onClick={onClose} title="Hide diagnostics">
          ✕
        </button>
      </div>

      <div className={styles.summary}>
        <span>peers: <b>{stats.length}</b></span>
        <span>tiles: <b>{remoteCount ?? 0}</b></span>
        <span>effect: <b>{effect ?? "none"}</b></span>
        <span>log: <b>{diagnostics.length}</b></span>
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

      <div className={styles.toolbar}>
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`${styles.filter} ${enabled.has(lvl) ? styles.filterOn : ""}`}
            onClick={() => toggleLevel(lvl)}
            title={`Toggle ${lvl} lines`}
          >
            {lvl}
          </button>
        ))}
        <button className={styles.action} onClick={copyLog} title="Copy full log">
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>

      <div className={styles.log} ref={logRef}>
        {shown.length === 0 && <span className={styles.dim}>no log entries</span>}
        {shown.map((d, i) => (
          <div key={i} className={`${styles.line} ${styles[`lvl_${d.level}`] ?? ""}`}>
            <span className={styles.t}>{ts(d.t)}</span>
            <span>{d.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
