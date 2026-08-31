import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMeroStream } from "../hooks/useMeroStream";
import { useLiveStream } from "../hooks/useLiveStream";
import { fmt } from "../lib/format";
import DataDialog from "../components/DataDialog";
import { MetricValue } from "../components/MetricValue";
import PeopleDialog from "../components/PeopleDialog";
import { buildRoster, initials, shortId } from "../lib/people";
import { getUsername, setUsername } from "../lib/session";
import {
  DEGRADED_DELIVERY_PERCENT,
  DEGRADED_FROM_BROADCASTERS,
  MAX_BROADCASTERS,
} from "../lib/slots";
import styles from "./CallPage.module.css";

/**
 * The call.
 *
 * 640×480 H.264, encoded in the browser, carried on ephemeral presence — never
 * persisted, never in the DAG, no WASM run per frame. Up to
 * {@link MAX_BROADCASTERS} people broadcast at once and everyone else spectates
 * (decoding every broadcaster, publishing nothing). The cap is derived from
 * gossipsub's fan-out, not chosen: see lib/slots.ts.
 *
 * Everything that is not needed to run the call — the §4 probe, the encoder
 * knobs, the replicated-state proof, the capacity budget — is behind "See more
 * data". Four numbers stay on the bar, because they are how you tell a working
 * call from a broken one and you should not have to open a panel for that.
 */
/** The strip's flavour of {@link MetricValue}: inline, with the strip's classes. */
function Stat(props: {
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <MetricValue
      {...props}
      as="span"
      wrapperClassName={styles.stat}
      valueClassName={styles.statValue}
      labelClassName={styles.statLabel}
    />
  );
}

export default function CallPage() {
  const stream = useMeroStream();
  const s = useLiveStream(true);

  // The STORED nickname — "" when never set, which is a state worth knowing:
  // it is what makes the identity control worth pointing at on first run.
  const [nickname, setNickname] = useState(getUsername());
  const [joined, setJoined] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const joinAttempted = useRef(false);
  // memberId → display name, so a tile says WHO it is showing. The contract
  // already stores the name each peer joined with; without this a tile is
  // labelled with a truncated public key, which identifies nobody.
  const [names, setNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<{ memberId: string; name: string }[]>(
    [],
  );

  // The name we actually join with. A placeholder rather than a stored value, so
  // "has not chosen yet" stays distinguishable from "chose the word guest" —
  // which is what lets the UI nudge exactly once.
  const effectiveName = nickname || "guest";

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
    void join(getUsername() || "guest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the identity dialog ONCE for someone who has never picked a name. Not a
  // blocking gate — the call still joins and still works as "guest" — because
  // demanding a form before showing anything is a worse first run than a tile
  // labelled with a placeholder.
  const nudged = useRef(false);
  useEffect(() => {
    if (nudged.current || !joined || nickname !== "") return;
    nudged.current = true;
    setShowPeople(true);
  }, [joined, nickname]);

  const rename = useCallback(
    (next: string) => {
      setNickname(next);
      void join(next);
    },
    [join],
  );

  // Refresh names when the participant set changes, plus a slow tick for someone
  // who renames themselves. Keyed on peer COUNT rather than "is any name
  // missing": the latter flips back as soon as the fetch lands, re-running this
  // effect and tearing down the interval for nothing.
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
          setMembers(
            ms.map((m) => ({ memberId: m.memberId, name: m.username })),
          );
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

  // Evict cached callbacks for peers who left. The cache only ever grew: one
  // closure per member id ever seen, held for the lifetime of this mounted page.
  // Tiny per entry, and genuinely unbounded over a long-running room with people
  // coming and going — an unbounded cache with no cleanup path is worth closing
  // even when each entry is cheap.
  // Memoized: this render path ticks at 1 Hz from the probe/reap tick, and both
  // this and the roster below allocate and sort. Cheap at a handful of members,
  // and needless work to repeat when none of the inputs moved.
  // One derivation of "who is live", used by both the roster and the ref-cache
  // eviction below. It was two: a joined string for change detection and a fresh
  // Set a few lines later, both from the same array.
  const liveIds = useMemo(
    () => new Set(s.remotePeers.map((peer) => peer.from)),
    [s.remotePeers],
  );
  useEffect(() => {
    for (const id of refCache.current.keys()) {
      if (!liveIds.has(id)) refCache.current.delete(id);
    }
  }, [liveIds]);

  const p = s.probe;
  // A local preview tile only exists while we are broadcasting — a spectator has
  // no camera open, and showing them an empty self-tile would suggest otherwise.
  const tileCount = s.remotePeers.length + (s.running ? 1 : 0);
  // Both from the hook. The comment here used to say "not recomputed" while
  // plainly recomputing `duty`, which is how the drift it warned about would have
  // come back one derived value further along.
  const { duty, load } = s;

  const canGoLive = s.slots.mayClaim && joined && s.supported !== false;

  // The roster, with "is this person broadcasting" folded in from the media
  // stream rather than from the contract — the contract knows who JOINED, and
  // only the presence traffic knows who is publishing right now.
  const me = stream.executorId ?? "me";
  const people = useMemo(
    () =>
      buildRoster({
        members: members.length
          ? members
          : [{ memberId: me, name: effectiveName }],
        liveIds,
        me,
        selfName: effectiveName,
        selfLive: s.running,
      }),
    [members, me, effectiveName, liveIds, s.running],
  );

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Mero Stream</h1>
          <span className={styles.roomId} title={stream.contextId ?? ""}>
            {stream.contextId ? `${stream.contextId.slice(0, 10)}…` : "no room"}
          </span>
        </div>
        <span className={styles.spacer} />
        <div className={styles.topbarRight}>
          <span
            className={styles.srOnly}
            data-testid="join-state"
            data-joined={joined}
          >
            {joined ? `joined, ${people.length} here` : "joining…"}
          </span>
          {/* Identity as a real control rather than a bare input. It shows the
              name it will change, which is the only way to notice it is still a
              placeholder, and it opens the roster so the change can be seen
              landing. Flagged when unset. */}
          <button
            type="button"
            className={styles.identityBtn}
            data-unset={nickname === ""}
            onClick={() => setShowPeople(true)}
            data-testid="identity-btn"
            title="Set your nickname and see who else is here"
          >
            <span className={styles.identityAvatar} aria-hidden="true">
              {initials(effectiveName)}
            </span>
            <span className={styles.identityName}>{effectiveName}</span>
            {nickname === "" && (
              <span className={styles.identityFlag}>set name</span>
            )}
          </button>
        </div>
      </header>

      <div className={styles.notices}>
        {s.supported === false && (
          <div
            className={`${styles.banner} ${styles.bannerError}`}
            data-testid="unsupported"
          >
            <span className={styles.bannerText}>
              This browser has no WebCodecs <code>VideoEncoder</code>. Chrome or
              Edge works; Safari needs 16.4+. You can still spectate — decoding
              is unaffected — but you cannot broadcast.
            </span>
          </div>
        )}
        {s.yielded && (
          <div
            className={`${styles.banner} ${styles.bannerWarn}`}
            data-testid="yielded-notice"
          >
            <span className={styles.bannerText}>
              <strong>
                All {MAX_BROADCASTERS} broadcast slots were taken, so your
                camera stopped.
              </strong>{" "}
              Someone else started before you did. You are still receiving
              everyone — &quot;Go live&quot; re-enables itself as soon as a slot
              frees up.
            </span>
            <button
              type="button"
              className={styles.bannerClose}
              onClick={s.clearYielded}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {/* Measured, not defensive: a second broadcaster loses roughly 40% of
            its frames on this transport, and no client-side pacing fixes it (the
            rate-share experiment is in the ladder, and it failed). Saying so is
            better than letting someone conclude their camera or network is
            broken. Shown once two are live, and not as an error, because the
            call is working as well as the transport allows. */}
        {s.slots.occupied >= DEGRADED_FROM_BROADCASTERS && (
          <div className={styles.banner} data-testid="degraded-notice">
            <span className={styles.bannerText}>
              <strong>
                {s.slots.occupied} people are broadcasting, so every stream is
                choppier.
              </strong>{" "}
              Frame rate is shared, and this transport delivers about{" "}
              {DEGRADED_DELIVERY_PERCENT}% of frames with{" "}
              {DEGRADED_FROM_BROADCASTERS} senders and less beyond that —
              measured, and not something the app can tune away. One broadcaster
              at a time is smooth. See <strong>See more data</strong> for the
              numbers.
            </span>
          </div>
        )}
        {s.error && (
          <div
            className={`${styles.banner} ${styles.bannerError}`}
            data-testid="live-error"
          >
            <span className={styles.bannerText}>{s.error}</span>
          </div>
        )}
      </div>

      <main
        className={styles.stage}
        data-count={Math.min(tileCount, 6)}
        data-many={tileCount > 6}
        data-testid="stage"
      >
        {tileCount === 0 && (
          <div className={styles.empty} data-testid="no-peers">
            <span className={styles.emptyTitle}>
              Nobody is broadcasting yet
            </span>
            <span className={styles.emptyHint}>
              {canGoLive
                ? `Hit “Go live” to share your camera. Up to ${MAX_BROADCASTERS} people can broadcast at once; everyone else watches.`
                : s.slots.full
                  ? `All ${MAX_BROADCASTERS} slots are taken.`
                  : "Waiting to join the room…"}
            </span>
          </div>
        )}

        {/* Local preview. Muted + playsInline: this is the encoder's source, not
            a monitor. It is always mounted — an unmounted <video> loses its
            srcObject, so remounting it on every start/stop would drop the camera
            stream the encoder is reading from — and only shown while running. */}
        <figure
          className={`${styles.tile} ${styles.tileSelf}`}
          data-testid="self-tile"
          hidden={!s.running}
        >
          <video
            ref={s.localVideoRef}
            className={styles.media}
            data-testid="local-video"
            muted
            playsInline
          />
          <figcaption className={styles.tileLabel}>
            <span className={styles.dot + " " + styles.dotLive} />
            <span className={styles.tileName}>You</span>
            <span className={styles.tileMeta}>
              {s.slots.myRank !== null ? `slot ${s.slots.myRank + 1}` : ""}
            </span>
          </figcaption>
        </figure>

        {/* One tile PER REMOTE SENDER. A single canvas fed by a single decoder
            cannot work beyond one sender: each is an independent H.264 bitstream
            and interleaving them into one decoder produces an error or a smear. */}
        {s.remotePeers.map((peer) => (
          <figure
            key={peer.from}
            className={styles.tile}
            data-testid="peer-tile"
            data-peer={peer.from}
          >
            {/* STABLE ref callback, memoized per peer. An inline
                `ref={(el) => attach(peer.from, el)}` is a NEW function on every
                render, so React detaches (null) and reattaches on each one — and
                the detach path closes that peer's decoder. Since the stats tick
                re-renders every second, the decoder was destroyed every second
                and each peer only ever decoded the keyframe after it: decode rate
                collapsed to ~3/s against 25/s posted, with 571 seq gaps, and the
                picture never advanced. */}
            <canvas
              ref={peerCanvasRef(peer.from)}
              className={styles.media}
              data-testid="remote-canvas"
              data-peer={peer.from}
            />
            {!peer.decoding && (
              <span className={styles.tileWaiting}>
                waiting for a keyframe…
              </span>
            )}
            <figcaption className={styles.tileLabel}>
              <span className={styles.dot + " " + styles.dotLive} />
              <span className={styles.tileName}>
                {names[peer.from] ?? shortId(peer.from)}
              </span>
              <span className={styles.tileMeta}>
                {peer.width}×{peer.height}
              </span>
            </figcaption>
          </figure>
        ))}
      </main>

      <footer className={styles.controls}>
        <button
          type="button"
          className={s.running ? styles.stopBtn : styles.primaryBtn}
          data-testid="capture-toggle"
          data-running={s.running}
          onClick={() => (s.running ? s.stop() : s.start())}
          disabled={s.running ? false : !canGoLive}
          title={
            s.running
              ? undefined
              : !joined
                ? "Joining the room…"
                : s.slots.full
                  ? `All ${MAX_BROADCASTERS} broadcast slots are taken`
                  : undefined
          }
        >
          {s.running ? "Stop broadcasting" : "Go live"}
        </button>

        <span
          className={`${styles.slotsPill} ${s.slots.full ? styles.slotsPillFull : ""}`}
          data-testid="slots-readout"
          data-occupied={s.slots.occupied}
          data-free={s.slots.free}
        >
          <span
            className={`${styles.dot} ${s.slots.occupied > 0 ? styles.dotLive : ""}`}
          />
          {s.slots.occupied}/{MAX_BROADCASTERS} broadcasting
          {!s.running && s.slots.full ? " · spectating" : ""}
        </span>

        <span className={styles.spacer} />

        <div className={styles.status}>
          <Stat
            label="Decode"
            value={fmt(p.renderFps, 1)}
            suffix="/s"
            testId="decode-rate"
          />
          <Stat
            label="Latency"
            value={fmt(p.latencyMsP50, 0)}
            suffix="ms"
            testId="latency-strip"
          />
          <Stat
            label="Ingest"
            value={fmt(p.encodedBytesPerSec / 1024, 0)}
            suffix=" KiB/s"
            testId="ingest-strip"
          />
          <Stat
            label="Capture"
            value={s.effectiveFps}
            suffix=" fps"
            testId="capture-fps"
            className={
              s.effectiveFps < s.fps ? styles.pressureTight : undefined
            }
          />
          <Stat
            label="Send load"
            value={duty > 0 ? (duty * 100).toFixed(0) : undefined}
            suffix="%"
            testId="load-strip"
            className={
              load === "over"
                ? styles.pressureOver
                : load === "tight"
                  ? styles.pressureTight
                  : styles.pressureOk
            }
          />
        </div>

        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setShowPeople(true)}
          data-testid="people-toggle"
        >
          People · {people.length}
        </button>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setShowData(true)}
          data-testid="details-toggle"
        >
          See more data
        </button>
      </footer>

      <PeopleDialog
        open={showPeople}
        onClose={() => setShowPeople(false)}
        people={people}
        name={nickname}
        onRename={rename}
        maxBroadcasters={MAX_BROADCASTERS}
      />

      <DataDialog
        open={showData}
        onClose={() => setShowData(false)}
        s={s}
        participants={people.length}
        maxBroadcasters={MAX_BROADCASTERS}
      />
    </div>
  );
}
