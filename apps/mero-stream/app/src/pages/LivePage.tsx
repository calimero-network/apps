import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMeroStream } from "../hooks/useMeroStream";
import { useLiveStream, LIVE_WIDTH, LIVE_HEIGHT } from "../hooks/useLiveStream";
import { getUsername, setUsername } from "../lib/session";
import styles from "./StreamPage.module.css";

const RAW_FRAME_BYTES = LIVE_WIDTH * LIVE_HEIGHT;

/**
 * Approach 2: 480p H.264 through Calimero.
 *
 * The distinction from /stream (approach 3) is the whole point, so it is stated
 * on the page: there, the WASM app ran a toy integer codec and was pinned at
 * 64x48 greyscale because every node had to compute bit-identical output. Here
 * the browser encodes with hardware H.264 and the app stores bytes it never
 * interprets, so determinism is not at stake and a real resolution is possible.
 *
 * This is still a capacity probe. The question it answers is no longer "can the
 * node compute video" (it doesn't have to) but "can the replication layer carry
 * ~188 KB/s of new state, and what does keeping it cost in tombstones".
 */
export default function LivePage() {
  const stream = useMeroStream();
  const navigate = useNavigate();
  const s = useLiveStream(true);

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

  useEffect(() => {
    if (joinAttempted.current) return;
    joinAttempted.current = true;
    void join(getUsername() || "prober");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = s.probe;
  const st = s.stats;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <button
            className={styles.switchBtn}
            onClick={() => navigate("/stream")}
          >
            ← Approach 3 (64×48 in-WASM codec)
          </button>
          <h1 className={styles.title}>
            Live 480p <span className={styles.version}>H.264 · approach 2</span>
          </h1>
          <p className={styles.devTag}>
            Browser encodes · the WASM app stores opaque bytes ·{" "}
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

      {s.supported === false && (
        <p className={styles.error}>
          This browser has no WebCodecs <code>VideoEncoder</code>. Chrome or
          Edge works; Safari needs 16.4+. The Calimero desktop shell is
          WKWebView, so use Chrome for measurement runs until desktop camera
          permissions are wired.
        </p>
      )}
      {s.error && <p className={styles.error}>{s.error}</p>}

      <section className={styles.canvases}>
        <figure className={styles.canvasCard}>
          <figcaption className={styles.canvasLabel}>
            Local capture ({LIVE_WIDTH}×{LIVE_HEIGHT} → hardware H.264)
          </figcaption>
          {/* Muted + playsInline: this is the encoder's source, not a monitor. */}
          <video
            ref={s.localVideoRef}
            className={styles.canvas}
            muted
            playsInline
          />
        </figure>
        <figure className={styles.canvasCard}>
          <figcaption className={styles.canvasLabel}>
            Remote decoded (get_chunks → VideoDecoder)
          </figcaption>
          <canvas ref={s.remoteCanvasRef} className={styles.canvas} />
        </figure>
      </section>

      <section className={styles.controls}>
        <button
          className={s.running ? styles.stopBtn : styles.startBtn}
          onClick={() => (s.running ? s.stop() : s.start())}
          disabled={(!joined && !s.running) || s.supported === false}
          title={!joined ? "Join the stream first" : undefined}
        >
          {s.running ? "Stop capture" : "Start capture"}
        </button>
        <label className={styles.fps}>
          <span>{s.fps} fps</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={s.fps}
            onChange={(e) => s.setFps(Number(e.target.value))}
          />
        </label>
        <label className={styles.fps}>
          <span>{(s.bitrate / 1_000_000).toFixed(1)} Mbps</span>
          <input
            type="range"
            min={250_000}
            max={4_000_000}
            step={250_000}
            value={s.bitrate}
            onChange={(e) => s.setBitrate(Number(e.target.value))}
          />
        </label>
      </section>

      <section className={styles.metrics}>
        <h2 className={styles.metricsTitle}>Replicated state (approach 2)</h2>
        <div className={styles.grid}>
          <Metric label="Live chunks" value={st?.liveChunks} />
          <Metric
            label="Live bytes"
            value={st ? (st.liveBytes / 1024).toFixed(0) : undefined}
            suffix=" KiB"
          />
          <Metric label="Chunks posted" value={st?.nextChunkSeq} />
          <Metric label="Pruned (tombstones)" value={st?.prunedChunks} />
          <Metric label="Last keyframe seq" value={st?.lastKeyframeSeq} />
          <Metric label="Oldest live chunk" value={st?.oldestLiveChunk} />
        </div>
        <p className={styles.note}>
          The reaper never prunes past the newest keyframe — a delta frame
          without its reference is undecodable, so an unclamped window would
          leave a stream that replicates happily and shows nothing. That clamp
          is why <strong>oldest live chunk</strong> tracks{" "}
          <strong>last keyframe seq</strong> rather than the window edge.
        </p>
      </section>

      <section className={styles.metrics}>
        <div className={styles.metricsHeader}>
          <h2 className={styles.metricsTitle}>Probe measurements (§4)</h2>
          <div className={styles.metricsActions}>
            <button className={styles.csvBtn} onClick={s.downloadCsv}>
              Download CSV ({p.framesRenderedTotal} chunks)
            </button>
            <button className={styles.resetBtn} onClick={s.resetProbe}>
              Reset
            </button>
          </div>
        </div>
        <div className={styles.grid}>
          <Metric label="Post rate" value={fmt(p.sendFps, 2)} suffix=" /s" />
          <Metric
            label="Decode rate"
            value={fmt(p.renderFps, 2)}
            suffix=" /s"
          />
          <Metric
            label="Ingest (encoded)"
            value={fmt(p.encodedBytesPerSec / 1024, 1)}
            suffix=" KiB/s"
          />
          <Metric
            label={`Compression (of ${(RAW_FRAME_BYTES / 1024).toFixed(0)} KiB/frame)`}
            value={fmt(p.compressionRatio, 1)}
            suffix="×"
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
            label="Post RTT p50"
            value={fmt(p.encodeMsP50, 0)}
            suffix=" ms"
          />
          <Metric label="Seq gaps" value={p.seqGaps} />
          <Metric label="Post errors" value={p.encodeErrors} />
        </div>
        <p className={styles.note}>
          Same two-clock caveat as approach 3: <strong>latency</strong> spans
          the sender&apos;s <code>createdAt</code> and this node&apos;s render,
          so trust it only where both nodes share a host clock. Note what
          changed though — the node does <em>no</em> codec work on this path, so
          if it still fails, the bottleneck is replication and storage rather
          than WASM CPU. That is the question this route exists to settle.
        </p>
      </section>
    </div>
  );
}

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
