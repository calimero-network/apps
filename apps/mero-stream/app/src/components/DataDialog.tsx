import { useEffect, useMemo, useRef } from "react";
import type { LiveController } from "../hooks/useLiveStream";
import { LIVE_WIDTH, LIVE_HEIGHT } from "../hooks/useLiveStream";
import { upstreamBitsPerSecond } from "../lib/capacity";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { fmt } from "../lib/format";
import { MetricValue } from "./MetricValue";
import styles from "./DataDialog.module.css";

const RAW_FRAME_BYTES = LIVE_WIDTH * LIVE_HEIGHT;

/**
 * Participant counts the bandwidth table illustrates. Broadcasters are derived
 * from `maxBroadcasters` per row rather than listed, so no row can describe a
 * state the app refuses to enter.
 *
 * 2 and 20 are the interesting ends: 2 is the cheapest possible call, and 20 is
 * far enough out to show that a broadcaster's cost keeps climbing (flood-publish
 * reaches every peer) while a spectator's stops (the mesh caps forwarding at
 * `mesh_n`).
 */
const SAMPLE_PARTICIPANTS = [2, 3, 4, 6, 8, 20];

/**
 * Everything that is not needed to run a call.
 *
 * This is where the page's whole lower half went: the §4 probe measurements, the
 * fps/bitrate controls, the replicated-state counters, the capacity budget and
 * the CSV export. The call itself now shows four numbers and a slot count, which
 * is what you need to tell a working call from a broken one.
 *
 * Polling lives here rather than in the hook: `get_live_stats` is a contract
 * round-trip to read a table this transport never writes to, so nobody should
 * pay for it while this is closed.
 */
/** The grid's flavour of {@link MetricValue}: a block cell with grid classes. */
function Metric(props: {
  label: string;
  value: number | string | null | undefined;
  suffix?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <MetricValue
      {...props}
      as="div"
      wrapperClassName={styles.metric}
      valueClassName={styles.metricValue}
      labelClassName={styles.metricLabel}
    />
  );
}

export default function DataDialog({
  open,
  onClose,
  s,
  participants,
  maxBroadcasters,
}: {
  open: boolean;
  onClose: () => void;
  s: LiveController;
  /** Members in the room, for the bandwidth estimate. */
  participants: number;
  /**
   * The broadcaster cap. A PROP, matching PeopleDialog, rather than an import —
   * the two dialogs are otherwise symmetric and were getting the same value two
   * different ways. The prop is the better of the two conventions because it
   * keeps both components testable at a cap other than whatever ships.
   */
  maxBroadcasters: number;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useDialogOpen(ref, open);

  useEffect(() => {
    if (!open) return;
    s.refreshStats();
    const id = setInterval(() => s.refreshStats(), 1000);
    return () => clearInterval(id);
    // `refreshStats` is a stable useCallback; listing `s` would re-run this on
    // every stats update, which is the update this effect causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const p = s.probe;
  const st = s.stats;

  // From the hook. This panel and the control-bar strip each derived the budget
  // from raw inputs and drifted — one read the slider ceiling, the other the
  // shared rate — so they disagreed exactly when a second broadcaster went live,
  // in the panel whose whole job is to be authoritative. One source now.
  const budget = s.budget;
  // Measured, not assumed: `encodeMsP50` is the median time a publish took, which
  // for a serial send loop is exactly the number the budget is spent against.
  const measuredRtt = p.encodeMsP50 ?? 0;
  // From the hook, so this panel and the control-bar strip cannot disagree — the
  // same reason `budget` moved there. `pressure` was also being called twice for
  // one classification.
  const { duty, load } = s;
  const dutyClass =
    load === "over" ? styles.over : load === "tight" ? styles.tight : styles.ok;

  // Memoized: the dialog re-renders every second while open (the stats poll), and
  // this only depends on the participant count.
  const rows = useMemo(
    () =>
      [
        ...SAMPLE_PARTICIPANTS,
        // The actual room, when it is not already a sample row, so the table
        // always contains a "you are here". Without this the highlight simply
        // never appeared for a 7-person call.
        ...(SAMPLE_PARTICIPANTS.includes(participants) ? [] : [participants]),
      ]
        .map((n) => [n, Math.min(n, maxBroadcasters)] as const)
        .sort((a, b) => a[0] - b[0]),
    [participants, maxBroadcasters],
  );

  const upstream = upstreamBitsPerSecond({
    participants: Math.max(participants, s.slots.occupied + 1),
    broadcasters: s.slots.occupied,
    bitrate: s.effectiveBitrate,
    broadcasting: s.running,
  });

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-testid="data-dialog"
      // A backdrop click and Escape both mean "close", and <dialog> only gives
      // us the second one. `cancel` covers Escape; `close` covers everything,
      // including the form-method=dialog button, so React state cannot drift out
      // of sync with the element.
      onClose={onClose}
    >
      <div className={styles.head}>
        <h2 className={styles.headTitle}>Session data</h2>
        <span className={styles.headSpacer} />
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          data-testid="data-dialog-close"
        >
          Close
        </button>
      </div>

      <div className={styles.body}>
        {/* ── Capacity ─────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Capacity</h3>
          </div>
          <div className={styles.grid}>
            <Metric
              label="Publishes needed"
              value={budget.slicesPerSecond.toFixed(1)}
              suffix=" /s"
              testId="slices-per-sec"
            />
            <Metric
              label="Publish RTT (measured p50)"
              value={measuredRtt ? measuredRtt.toFixed(0) : undefined}
              suffix=" ms"
              testId="publish-rtt"
            />
            <Metric
              label={`Send loop used (saturates at ${budget.maxSustainableRttMs.toFixed(0)} ms)`}
              value={(duty * 100).toFixed(0)}
              suffix=" %"
              testId="duty-cycle"
              className={dutyClass}
            />
            <Metric
              label={`Est. upstream at ${s.slots.occupied} live / ${participants} here`}
              value={(upstream / 1_000_000).toFixed(1)}
              suffix=" Mbps"
              testId="upstream-estimate"
            />
            <Metric
              label="Keyframe fragments"
              value={budget.keyframeFragments}
              testId="keyframe-fragments"
            />
            <Metric
              label="Broadcast slots"
              value={`${s.slots.occupied}/${maxBroadcasters}`}
              testId="slots-detail"
            />
          </div>
          <p className={styles.note}>
            <strong>
              The send loop is usually the first thing to run out.
            </strong>{" "}
            Fragments are published <em>serially</em> — the node assigns the
            per-author LWW sequence when it accepts the call, so firing them
            concurrently races that assignment and lets the channel drop a
            fragment of a frame that was fully published. So{" "}
            <code>{budget.slicesPerSecond.toFixed(1)}</code> publishes a second
            have to fit in one second: above{" "}
            <code>{budget.maxSustainableRttMs.toFixed(0)} ms</code> per publish,
            frames drop no matter how much bandwidth is free. This ceiling does
            not depend on how many people are in the call.
          </p>
          <p className={styles.note}>
            <strong>
              Upstream is not what caps the broadcaster count — frame loss is.
            </strong>{" "}
            The cap comes from a four-node measurement (96% of frames delivered
            with one broadcaster, 43% with two, 22% with three); the bandwidth
            model below allowed four and was wrong by 2&times;. It still bounds
            what is worth trying, so it is still here. core runs gossipsub with{" "}
            <code>flood_publish</code> and <code>mesh_n = 4</code>, so a
            publisher sends its own frames to every subscribed peer while
            forwarding of everyone else&apos;s follows the mesh. Two
            consequences worth knowing: the forwarding term stops growing past 5
            participants (so spectators are cheap to add, while each extra
            person taxes every broadcaster another{" "}
            {(s.effectiveBitrate / 1_000_000).toFixed(1)} Mbps), and a spectator
            still uploads nearly a broadcaster&apos;s worth — gossipsub makes
            every node a relay, so spectating saves the camera and the encoder,
            not the uplink.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Participants</th>
                  <th>Broadcasters</th>
                  <th>Broadcaster up</th>
                  <th>Spectator up</th>
                </tr>
              </thead>
              <tbody>
                {/* Broadcaster counts are DERIVED, never listed. They used to
                    be hardcoded up to 4, from when the cap was 4 — so once the
                    measurement moved it to 2 this table showed rows like "8
                    people, 4 broadcasting" that no room can ever reach, in the
                    one panel a person reads to understand their own call.
                    Capping each row at maxBroadcasters keeps every row
                    reachable, and still shows the shape that matters: the
                    broadcaster column climbing with participants while the
                    spectator column goes flat past five. */}
                {rows.map(([n, sc]) => (
                  <tr
                    key={`${n}-${sc}`}
                    className={n === participants ? styles.rowHere : undefined}
                  >
                    <td>{n}</td>
                    <td>{sc}</td>
                    <td>
                      {(
                        upstreamBitsPerSecond({
                          participants: n,
                          broadcasters: sc,
                          bitrate: 1_500_000,
                          broadcasting: true,
                        }) / 1_000_000
                      ).toFixed(1)}{" "}
                      Mbps
                    </td>
                    <td>
                      {(
                        upstreamBitsPerSecond({
                          participants: n,
                          broadcasters: sc,
                          bitrate: 1_500_000,
                          broadcasting: false,
                        }) / 1_000_000
                      ).toFixed(1)}{" "}
                      Mbps
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            ⚠️ All of that is for <strong>directly connected</strong> peers.
            Behind a relay the whole call crosses one circuit — 18 Mbps at the
            2-broadcaster cap with 6 people, and 36 Mbps at the 4 the bandwidth
            model once allowed, which is the &quot;resource limit exceeded&quot;
            collapse on record from the 2026-08-07 cross-network call. The
            browser cannot tell whether it is relayed (libp2p transport state is
            not exposed to the page), so publish latency above is the only
            signal there is.
          </p>
        </section>

        {/* ── Probe ────────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Measurements</h3>
            <div className={styles.sectionActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={s.downloadCsv}
                data-testid="download-csv"
              >
                Download CSV ({p.framesRenderedTotal})
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={s.resetProbe}
                data-testid="reset-probe"
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
              testId="decode-rate-detail"
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
            <Metric label="Seq gaps" value={p.seqGaps} testId="seq-gaps" />
            <Metric
              label="Publish errors"
              value={p.encodeErrors}
              testId="post-errors"
            />
          </div>
          <p className={styles.note}>
            <strong>Latency spans two clocks</strong> — the sender&apos;s{" "}
            <code>createdAt</code> and this machine&apos;s render — so trust it
            only where both nodes share a host clock. Publish RTT is the
            skew-proof figure. And <strong>measure after Reset</strong>: a
            receiver&apos;s first drain stamps a whole backlog within a few
            milliseconds, which reports decode rates in the thousands and
            understates latency for those frames.
          </p>
        </section>

        {/* ── Encoder ──────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Encoder</h3>
          </div>
          <div className={styles.controlRow}>
            <label className={styles.control}>
              <span className={styles.controlLabel}>
                <span>Frame rate</span>
                <span className={styles.controlValue}>{s.fps} fps</span>
              </span>
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={s.fps}
                onChange={(e) => s.setFps(Number(e.target.value))}
                data-testid="fps-slider"
              />
            </label>
            <label className={styles.control}>
              <span className={styles.controlLabel}>
                <span>Bitrate ceiling</span>
                <span className={styles.controlValue}>
                  {(s.bitrate / 1_000_000).toFixed(1)} Mbps
                </span>
              </span>
              <input
                type="range"
                min={250_000}
                max={4_000_000}
                step={250_000}
                value={s.bitrate}
                onChange={(e) => s.setBitrate(Number(e.target.value))}
                data-testid="bitrate-slider"
              />
            </label>
            <div className={styles.control}>
              <span className={styles.controlLabel}>
                <span>Actually encoding at</span>
                <span
                  className={styles.controlValue}
                  data-testid="effective-bitrate"
                  data-value={s.effectiveBitrate}
                >
                  {(s.effectiveBitrate / 1000).toFixed(0)} kbps
                </span>
              </span>
            </div>
          </div>
          <p className={styles.note}>
            The defaults — <strong>640×480, 25 fps, 1.5 Mbps</strong> — are what
            the app ships with and what the numbers above were taken at. Raising
            the frame rate does <em>not</em> raise the byte rate: the encoder
            targets a fixed bitrate, so more frames means fewer bytes each. It
            does cost send-loop budget, because every frame is its own publish.
          </p>
          <p className={styles.note}>
            <strong>Capturing at</strong> is that ceiling{" "}
            <em>divided among the live broadcasters</em>, and the division is
            measured rather than cautious. A four-node run published a real 25
            fps stream from one, two, three and four nodes and counted what a
            subscriber received: <strong>96%</strong> of frames at one
            broadcaster, <strong>43%</strong> at two, <strong>22%</strong> at
            three. At two the send side was healthy — 24.5 of 25 fps published,
            zero errors — so the loss is the transport, not the sender: presence
            is a single-writer LWW register, the node drops an envelope whose
            sequence is at or below the highest already applied, and gossip
            reordering gets likelier as the aggregate publish rate rises.
            Aggregate rate is the variable, so two people at ~13 fps put the
            same load on the wire as one at 25.
          </p>
          <p className={styles.note}>
            <strong>Actually encoding at</strong> is a separate mechanism:
            congestion control backing off on measured publish latency.
          </p>
        </section>

        {/* ── DAG proof ────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Replicated state</h3>
          </div>
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
              label="Pruned (tombstones)"
              value={st?.prunedChunks}
              testId="pruned-chunks"
            />
            <Metric
              label="Chunk senders"
              value={st?.senders.length}
              testId="sender-count"
            />
          </div>
          <p className={styles.note}>
            <strong>These should all be zero while the tiles are moving</strong>{" "}
            — that is the measurement, not a broken read. Frames ride an
            ephemeral-presence slice: encrypted under the context group key,
            signed, gossiped, never persisted, never in the DAG, swept by the
            node after 7 s. There is no <code>get_chunks</code> round-trip
            either, because the bytes arrive in the event itself. A non-zero
            counter here means something wrote chunks through the contract — the{" "}
            <code>/stream</code> route, or an older client.
          </p>
          <p className={styles.note}>
            What it costs: a slice is capped at 16 KiB, so a keyframe is
            fragmented, and the channel is a single-writer register — an
            envelope arriving after a newer one is dropped. A delta frame is one
            fragment and unaffected; a keyframe that loses a fragment is never
            shown, and the next keyframe is the retry. <strong>Seq gaps</strong>{" "}
            counts exactly that.
          </p>
        </section>
      </div>
    </dialog>
  );
}

/**
 * `testId` / `data-value` exist for the automated browser run. The rendered text
 * carries a unit suffix and an em-dash placeholder, and the class names are
 * CSS-module hashes that change on every build — so scraping either would give a
 * test that breaks for reasons unrelated to the app. `data-value` is the raw
 * number, or "" when absent.
 */
