import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMeroStream } from "../hooks/useMeroStream";
import { useStream, CAPTURE_WIDTH, CAPTURE_HEIGHT } from "../hooks/useStream";
import { getUsername, setUsername } from "../lib/session";
import styles from "./StreamPage.module.css";

// Raw luma bytes per captured frame (1 byte/pixel) — the denominator for the
// compression-ratio readout against the contract's reported encodedBytes.
const RAW_BYTES = CAPTURE_WIDTH * CAPTURE_HEIGHT;

/**
 * The Mero Stream capture + diagnostics route (DEV / capacity-probe only).
 *
 * Left: the LOCAL preview canvas — the exact downscaled luma we hand to the
 * contract (not the raw webcam). Right: the REMOTE decoded canvas — frames a
 * peer (or this node) posted, drained via get_frame and painted back.
 *
 * Below, two panels that are deliberately NOT the same kind of thing:
 *
 *   "Stream stats"        contract state, read back via get_stats — live
 *                         fragments, monotone seq, tombstone pressure (C3).
 *   "Probe measurements"  the §4 deliverable, measured by this frontend across
 *                         the whole capture→gossip→decode→render path, and
 *                         exportable as the per-frame CSV P3's load curve needs.
 *
 * You must JOIN the stream before encode_frame is accepted (membership gate), so
 * we auto-join on mount with the saved/typed name — mirroring mero-meet's lobby.
 */
export default function StreamPage() {
  const stream = useMeroStream();
  const navigate = useNavigate();
  const s = useStream(true);

  const [username, setUsernameInput] = useState(getUsername() || "prober");
  const [joined, setJoined] = useState(false);
  const joinAttempted = useRef(false);

  const join = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setUsername(trimmed);
      const m = await stream.join(trimmed);
      if (m) setJoined(true);
    },
    [stream],
  );

  // Auto-join once on mount so the membership gate is satisfied before the first
  // encode_frame. (StrictMode double-invoke guarded by the ref.)
  useEffect(() => {
    if (joinAttempted.current) return;
    joinAttempted.current = true;
    void join(getUsername() || "prober");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = s.stats;
  const p = s.probe;
  const ratio =
    s.lastEncodedBytes && s.lastEncodedBytes > 0
      ? (RAW_BYTES / s.lastEncodedBytes).toFixed(2)
      : "—";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <button
            className={styles.switchBtn}
            onClick={() => navigate("/streams")}
          >
            ← All streams
          </button>
          <h1 className={styles.title}>
            {stats?.name || "Stream"}{" "}
            <span className={styles.version}>v{__APP_VERSION__}</span>
          </h1>
          <p className={styles.devTag}>
            Diagnostic route · media rides the contract (no WebRTC) ·{" "}
            {joined ? "joined" : "joining…"}
          </p>
        </div>
        <div className={styles.headerActions}>
          <input
            className={styles.nameInput}
            value={username}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void join(username)}
            maxLength={40}
            placeholder="Your name"
          />
          <button
            className={styles.joinBtn}
            onClick={() => void join(username)}
          >
            {joined ? "Rejoin" : "Join"}
          </button>
        </div>
      </header>

      {s.error && <p className={styles.error}>{s.error}</p>}

      <section className={styles.canvases}>
        <figure className={styles.canvasCard}>
          <figcaption className={styles.canvasLabel}>
            Local capture ({CAPTURE_WIDTH}×{CAPTURE_HEIGHT} luma → contract)
          </figcaption>
          <canvas ref={s.localCanvasRef} className={styles.canvas} />
        </figure>
        <figure className={styles.canvasCard}>
          <figcaption className={styles.canvasLabel}>
            Remote decoded (get_frame → paint)
          </figcaption>
          <canvas ref={s.remoteCanvasRef} className={styles.canvas} />
        </figure>
      </section>

      <section className={styles.controls}>
        <button
          className={s.running ? styles.stopBtn : styles.startBtn}
          onClick={() => (s.running ? s.stop() : s.start())}
          disabled={!joined && !s.running}
          title={!joined ? "Join the stream first" : undefined}
        >
          {s.running ? "Stop capture" : "Start capture"}
        </button>
        <label className={styles.fps}>
          <span>{s.fps} fps</span>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={s.fps}
            onChange={(e) => s.setFps(Number(e.target.value))}
          />
        </label>
      </section>

      <section className={styles.metrics}>
        <h2 className={styles.metricsTitle}>Stream stats</h2>
        <div className={styles.grid}>
          <Metric label="Live fragments" value={stats?.liveFragments} />
          <Metric label="Next seq (frames sent)" value={stats?.nextSeq} />
          <Metric label="Oldest live seq" value={stats?.oldestLiveSeq} />
          <Metric
            label="Pruned frames (tombstones)"
            value={stats?.prunedFrames}
          />
          <Metric label="Members" value={stats?.memberCount} />
          <Metric
            label="Last encoded bytes"
            value={s.lastEncodedBytes ?? undefined}
          />
          <Metric
            label={`Compression (of ${RAW_BYTES} B raw)`}
            value={ratio}
            suffix="×"
          />
        </div>
        <p className={styles.note}>
          Tombstone growth (pruned frames) and live-fragment count are the
          primary Task-3 ceiling signals — watch them climb under sustained
          capture.
        </p>
      </section>

      {/* The §4 deliverable. Everything above is contract state; everything here
          is measured by the frontend across the full capture→render path. */}
      <section className={styles.metrics}>
        <div className={styles.metricsHeader}>
          <h2 className={styles.metricsTitle}>Probe measurements (§4)</h2>
          <div className={styles.metricsActions}>
            <button className={styles.csvBtn} onClick={s.downloadCsv}>
              Download CSV ({p.framesRenderedTotal} frames)
            </button>
            <button className={styles.resetBtn} onClick={s.resetProbe}>
              Reset
            </button>
          </div>
        </div>
        <div className={styles.grid}>
          <Metric
            label="Send rate (accepted)"
            value={fmt(p.sendFps, 2)}
            suffix=" fps"
          />
          <Metric
            label="Render rate (peer)"
            value={fmt(p.renderFps, 2)}
            suffix=" fps"
          />
          <Metric
            label="Ingest (compressed)"
            value={fmt(kib(p.encodedBytesPerSec), 2)}
            suffix=" KiB/s"
          />
          <Metric
            label="Latency p50"
            value={fmt(p.latencyMsP50, 0)}
            suffix=" ms"
          />
          <Metric
            label="Latency p95"
            value={fmt(p.latencyMsP95, 0)}
            suffix=" ms"
          />
          <Metric
            label="Latency max"
            value={fmt(p.latencyMsMax, 0)}
            suffix=" ms"
          />
          <Metric
            label="Encode RTT p50"
            value={fmt(p.encodeMsP50, 0)}
            suffix=" ms"
          />
          <Metric
            label="Encode RTT p95"
            value={fmt(p.encodeMsP95, 0)}
            suffix=" ms"
          />
          <Metric label="Seq gaps (drop proxy)" value={p.seqGaps} />
          <Metric label="Encode errors" value={p.encodeErrors} />
        </div>
        <p className={styles.note}>
          <strong>Latency</strong> spans two clocks (sender{" "}
          <code>createdAt</code> → this node&apos;s render), so it is only
          trustworthy where both nodes share a host clock — the solo two-node
          harness. <strong>Encode RTT</strong> is measured on one clock and is
          an upper bound on in-WASM encode cost: it also contains JSON
          serialization, transport, the storage commit and the delta seal.
          Per-fragment WASM CPU, sealed delta size and RocksDB growth are
          node-side and are not visible from here — see the PR notes.
          {s.csvTruncated && (
            <>
              {" "}
              <strong>
                CSV retention cap reached — later frames are NOT in the export.
              </strong>
            </>
          )}
        </p>
      </section>
    </div>
  );
}

/** KiB from bytes. */
function kib(bytes: number): number {
  return bytes / 1024;
}

/** Render a possibly-absent measurement without inventing a zero. */
function fmt(
  value: number | null | undefined,
  digits: number,
): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value))
    return undefined;
  return value.toFixed(digits);
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string | undefined;
  suffix?: string;
}) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>
        {value ?? "—"}
        {value !== undefined && suffix ? suffix : ""}
      </span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
