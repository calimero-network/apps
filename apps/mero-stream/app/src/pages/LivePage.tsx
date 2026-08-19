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
  // memberId → display name, so a tile says WHO it is showing. The contract already
  // stores the name each peer joined with; without this a tile is labelled with a
  // truncated public key, which identifies nobody.
  const [names, setNames] = useState<Record<string, string>>({});

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

  // Refresh names when the participant set changes, plus a slow tick for someone
  // who renames themselves. Keyed on peer COUNT rather than "is any name missing":
  // the latter flips back as soon as the fetch lands, re-running this effect and
  // tearing down the interval for nothing.
  const peerCount = s.remotePeers.length;
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    const refresh = () =>
      stream
        .getMembers()
        .then((ms) => {
          if (cancelled || !ms) return;
          setNames(Object.fromEntries(ms.map((m) => [m.memberId, m.username])));
        })
        .catch(() => {
          /* transient RPC error — the next tick retries */
        });
    void refresh();
    const id = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [joined, peerCount, stream]);

  const p = s.probe;
  const st = s.stats;

  // One stable ref callback per peer, cached by member id, so React does not
  // detach/reattach the canvas on every render. See the comment at the call site.
  const refCache = useRef(
    new Map<string, (el: HTMLCanvasElement | null) => void>(),
  );
  // Read `attachPeerCanvas` through a ref so the cached closures never capture a
  // stale one, which also keeps this callback's identity stable for all peers.
  const attachRef = useRef(s.attachPeerCanvas);
  attachRef.current = s.attachPeerCanvas;
  const peerCanvasRef = useCallback((from: string) => {
    let fn = refCache.current.get(from);
    if (!fn) {
      fn = (el: HTMLCanvasElement | null) => attachRef.current(from, el);
      refCache.current.set(from, fn);
    }
    return fn;
  }, []);

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
          <p className={styles.devTag} data-testid="join-state">
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
            data-testid="username-input"
          />
          <button
            className={styles.joinBtn}
            onClick={() => void join(username)}
            data-testid="username-submit"
          >
            {joined ? "Rejoin" : "Join"}
          </button>
        </div>
      </header>

      {s.supported === false && (
        <p className={styles.error} data-testid="unsupported">
          This browser has no WebCodecs <code>VideoEncoder</code>. Chrome or
          Edge works; Safari needs 16.4+. The Calimero desktop shell is
          WKWebView, so use Chrome for measurement runs until desktop camera
          permissions are wired.
        </p>
      )}
      {s.error && (
        <p className={styles.error} data-testid="live-error">
          {s.error}
        </p>
      )}

      <section className={styles.canvases}>
        <figure className={styles.canvasCard}>
          <figcaption className={styles.canvasLabel}>
            Local capture ({LIVE_WIDTH}×{LIVE_HEIGHT} → hardware H.264)
          </figcaption>
          {/* Muted + playsInline: this is the encoder's source, not a monitor. */}
          <video
            ref={s.localVideoRef}
            className={styles.canvas}
            data-testid="local-video"
            muted
            playsInline
          />
        </figure>
        {/* One tile PER REMOTE SENDER. There used to be a single canvas fed by a
            single decoder, which cannot work beyond one sender: each is an
            independent H.264 bitstream and interleaving them into one decoder
            produces an error or a smear. */}
        {s.remotePeers.length === 0 && (
          <figure className={styles.canvasCard}>
            <figcaption className={styles.canvasLabel}>
              Waiting for someone else to start
            </figcaption>
            <div className={styles.canvas} data-testid="no-peers" />
          </figure>
        )}
        {s.remotePeers.map((peer) => (
          <figure
            key={peer.from}
            className={styles.canvasCard}
            data-testid="peer-tile"
            data-peer={peer.from}
          >
            <figcaption className={styles.canvasLabel}>
              {names[peer.from] ?? `${peer.from.slice(0, 8)}…`} · {peer.width}×
              {peer.height}
              {peer.decoding ? "" : " · waiting for keyframe"}
            </figcaption>
            {/* STABLE ref callback, memoized per peer. An inline
                `ref={(el) => attach(peer.from, el)}` is a NEW function on every
                render, so React detaches (null) and reattaches on each one — and
                the detach path closes that peer's decoder. Since the stats tick
                re-renders every second, the decoder was destroyed every second and
                each peer only ever decoded the keyframe after it: decode rate
                collapsed to ~3/s against 25/s posted, with 571 seq gaps, and the
                picture never advanced. */}
            <canvas
              ref={peerCanvasRef(peer.from)}
              className={styles.canvas}
              data-testid="remote-canvas"
              data-peer={peer.from}
            />
          </figure>
        ))}
      </section>

      <section className={styles.controls}>
        <button
          className={s.running ? styles.stopBtn : styles.startBtn}
          data-testid="capture-toggle"
          data-running={s.running}
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
        {/* Switchable while a call is running, on purpose: flipping mid-run is how
            you compare the two on one camera and one link. It resets the decoders
            (a decoder mid-GOP cannot continue from the other transport's first
            frame), so expect one keyframe interval of blank tiles. */}
        <div
          className={styles.transport}
          role="group"
          aria-label="Transport"
          data-testid="transport-switch"
          data-transport={s.transport}
        >
          <button
            type="button"
            className={styles.transportBtn}
            aria-pressed={s.transport === "contract"}
            data-testid="transport-contract"
            onClick={() => s.setTransport("contract")}
          >
            post_chunk (state)
          </button>
          <button
            type="button"
            className={styles.transportBtn}
            aria-pressed={s.transport === "ephemeral"}
            data-testid="transport-ephemeral"
            onClick={() => s.setTransport("ephemeral")}
          >
            ephemeral (no DAG)
          </button>
        </div>
      </section>

      <section className={styles.metrics}>
        <h2 className={styles.metricsTitle}>Replicated state (approach 2)</h2>
        <div className={styles.grid}>
          <Metric
            label="Live chunks"
            value={st?.liveChunks}
            testId="live-chunks"
          />
          <Metric
            label="Live bytes"
            value={st ? (st.liveBytes / 1024).toFixed(0) : undefined}
            suffix=" KiB"
            testId="live-bytes-kib"
          />
          <Metric
            label="Chunks posted"
            value={st?.senders.reduce((n, s) => n + s.nextSeq, 0)}
            testId="chunks-posted"
          />
          <Metric
            label="Pruned (tombstones)"
            value={st?.prunedChunks}
            testId="pruned-chunks"
          />
          <Metric
            label="Senders"
            value={st?.senders.length}
            testId="sender-count"
          />
          <Metric
            label="Encoding at"
            value={(s.effectiveBitrate / 1000).toFixed(0)}
            suffix=" kbps"
            testId="effective-bitrate"
          />
        </div>
        {st && st.senders.length > 0 && (
          <table className={styles.senderTable} data-testid="sender-table">
            <thead>
              <tr>
                <th>Sender</th>
                <th>Posted</th>
                <th>Live</th>
                <th>Oldest</th>
                <th>Keyframe</th>
                <th>Pruned</th>
              </tr>
            </thead>
            <tbody>
              {st.senders.map((s) => (
                <tr key={s.from} data-testid={`sender-row-${s.from}`}>
                  <td title={s.from}>{s.from.slice(0, 8)}…</td>
                  <td>{s.nextSeq}</td>
                  <td>{s.liveChunks}</td>
                  <td>{s.oldestLive}</td>
                  <td>{s.lastKeyframe}</td>
                  <td>{s.pruned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={styles.note}>
          Every counter here is <strong>per sender</strong>. Chunks used to
          share one global sequence and one global keyframe pointer, which meant
          two people posting at once minted the same seq, collided on one
          storage key, and silently overwrote each other — and the reaper,
          clamped to that same global pointer, could drop one sender&apos;s only
          keyframe while protecting another&apos;s. Each sender now owns its own
          sequence, its own keyframe, and its own reaper.
        </p>
        <p className={styles.note}>
          <strong>Encoding at</strong> can sit below the bitrate slider: the
          slider is a ceiling, and send-side congestion control backs off when{" "}
          the publish starts queueing. The browser cannot see whether the node
          is relayed, so post latency is the signal. The two transports are not
          on the same scale — <code>post_chunk</code> waits for a WASM run and a
          storage commit, <code>set_ephemeral</code> returns once the node has
          encrypted and queued the slice — so compare a transport against
          itself, never one against the other.
        </p>
        {s.transport === "ephemeral" ? (
          <p className={styles.note} data-testid="transport-note">
            <strong>Ephemeral transport (core 0.11.0-rc.24).</strong> Frames
            ride an ephemeral-presence slice: encrypted under the context group
            key, signed, gossiped, never persisted, never in the DAG, swept by
            the node after 7 s. So every counter in this panel <em>should</em>{" "}
            stay at zero while the tiles above are moving — that is the
            measurement, not a broken read. There is also no{" "}
            <code>get_chunks</code> round-trip on this path, because the bytes
            arrive in the event itself.
            <br />
            What it costs: a slice is capped at 16 KiB, so a keyframe is
            fragmented, and the channel is a single-writer register — an
            envelope that arrives after a newer one is dropped. A delta frame is
            one fragment and unaffected; a keyframe that loses a fragment is
            simply never shown, and the next keyframe is the retry. Watch{" "}
            <strong>Seq gaps</strong> for exactly that.
          </p>
        ) : (
          <p className={styles.note} data-testid="transport-note">
            <strong>Contract transport.</strong> Every access unit is written
            into replicated state, so the counters above are the cost of the
            picture — and <code>prune_chunks</code> writes <em>more</em> deltas
            (tombstones) to walk it back. Switch to the ephemeral transport to
            run the same camera through a channel that writes nothing at all.
          </p>
        )}
      </section>

      <section className={styles.metrics}>
        <div className={styles.metricsHeader}>
          <h2 className={styles.metricsTitle}>Probe measurements (§4)</h2>
          <div className={styles.metricsActions}>
            <button className={styles.csvBtn} onClick={s.downloadCsv}>
              Download CSV ({p.framesRenderedTotal} chunks)
            </button>
            <button
              className={styles.resetBtn}
              data-testid="reset-probe"
              onClick={s.resetProbe}
            >
              Reset
            </button>
          </div>
        </div>
        <div className={styles.grid}>
          <Metric
            label="Post rate"
            value={fmt(p.sendFps, 2)}
            suffix=" /s"
            testId="post-rate"
          />
          <Metric
            label="Decode rate"
            value={fmt(p.renderFps, 2)}
            suffix=" /s"
            testId="decode-rate"
          />
          <Metric
            label="Ingest (encoded)"
            value={fmt(p.encodedBytesPerSec / 1024, 1)}
            suffix=" KiB/s"
            testId="ingest-kib-s"
          />
          <Metric
            label={`Compression (of ${(RAW_FRAME_BYTES / 1024).toFixed(0)} KiB/frame)`}
            value={fmt(p.compressionRatio, 1)}
            suffix="×"
            testId="compression-ratio"
          />
          <Metric
            label="Latency p50"
            value={fmt(p.latencyMsP50, 0)}
            suffix=" ms"
            testId="latency-p50"
          />
          <Metric
            label="Latency p95"
            value={fmt(p.latencyMsP95, 0)}
            suffix=" ms"
            testId="latency-p95"
          />
          <Metric
            label="Post RTT p50"
            value={fmt(p.encodeMsP50, 0)}
            suffix=" ms"
            testId="post-rtt-p50"
          />
          <Metric label="Seq gaps" value={p.seqGaps} testId="seq-gaps" />
          <Metric
            label="Post errors"
            value={p.encodeErrors}
            testId="post-errors"
          />
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

/**
 * `testId` / `data-value` exist for the automated browser run
 * (`app/e2e/browser-call.mjs`). The rendered text carries a unit suffix and an
 * em-dash placeholder, and the class names are CSS-module hashes that change on
 * every build — so scraping either would give a test that breaks for reasons
 * unrelated to the app. `data-value` is the raw number, or "" when absent.
 */
function Metric({
  label,
  value,
  suffix,
  testId,
}: {
  label: string;
  // `null` is a distinct, meaningful state and not an oversight: `seqGaps` becomes
  // null once a second sender exists, because seqs come from a shared space and a
  // span-based gap count is then pure fiction. Both render as "—".
  value: number | string | null | undefined;
  suffix?: string;
  testId?: string;
}) {
  return (
    <div className={styles.metric}>
      <span
        className={styles.metricValue}
        data-testid={testId}
        data-value={value ?? ""}
      >
        {value ?? "—"}
        {value !== undefined && value !== null && suffix ? suffix : ""}
      </span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
