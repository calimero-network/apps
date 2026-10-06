import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMeroStream } from "../hooks/useMeroStream";
import { useLiveStream } from "../hooks/useLiveStream";
import { fmt } from "../lib/format";
import DataDialog from "../components/DataDialog";
import { MetricValue } from "../components/MetricValue";
import PeopleDialog from "../components/PeopleDialog";
import { buildRoster, initials, shortId } from "../lib/people";
import { JOIN_DEADLINE_MS, retryUntilValue } from "../lib/joinRetry";
import SessionMenu from "../components/SessionMenu";
import { useNavigate } from "react-router-dom";
import {
  getActiveNamespaceId,
  getRoomName,
  getUsername,
  setUsername,
} from "../lib/session";
import {
  DEGRADED_DELIVERY_PERCENT,
  DEGRADED_FROM_BROADCASTERS,
  MAX_BROADCASTERS,
} from "../lib/slots";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BrandMark,
  ChevronLeftIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PhoneOffIcon,
  UsersIcon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "../components/icons";
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
 * Laid out like a video call app, not a dashboard: the tiles own the screen
 * and the bar carries only call controls. Everything that is not needed to run
 * the call — the live health strip, the §4 probe, the encoder knobs, the
 * replicated-state proof, the capacity budget, the node — is behind the "…"
 * menu and the Call details panel.
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
  const navigate = useNavigate();
  // Read once per mount: the active room does not change while this page is up,
  // and re-reading on every render would make the control flicker mid-call.
  const [namespaceId] = useState(() => getActiveNamespaceId());
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

  // Each join supersedes the one before it (a rename mid-retry must not be
  // overwritten by the stale name landing later), and unmount cancels all.
  // `alive` is re-set on mount so StrictMode's simulated unmount/remount does
  // not cancel the first join for good.
  const joinGeneration = useRef(0);
  const alive = useRef(true);
  // Every attempt goes through the CURRENT execute: one captured before the
  // provider was ready would keep failing "Not connected" for the whole retry.
  const streamRef = useRef(stream);
  streamRef.current = stream;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Retried, not one-shot: entering a room this node has only just learned
  // about races the context's first sync, and until it lands `join` is refused
  // (core's Uninitialized, which useExecute resolves as null). One attempt left
  // the page on "joining…" for good. See lib/joinRetry.ts.
  const join = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUsername(trimmed);
    const generation = ++joinGeneration.current;
    const m = await retryUntilValue(() => streamRef.current.join(trimmed), {
      deadlineMs: JOIN_DEADLINE_MS,
      isCancelled: () =>
        !alive.current || joinGeneration.current !== generation,
    });
    if (m) setJoined(true);
  }, []);

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
  // `myId`, not `executorId`: the roster is keyed by what the CONTRACT calls
  // the caller, which on an account is the certified device key rather than
  // the account the writes go out as. See lib/identity.
  const me = stream.myId ?? "me";
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

  const roomName = stream.contextId ? getRoomName(stream.contextId) : "";
  const backLabel = namespaceId ? "Rooms" : "Streams";
  const leave = () =>
    navigate(namespaceId ? `/streams/${namespaceId}` : "/streams");

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          {/* There was no way out of a call except the browser's back button.
              Routes to the room list when we know which stream this room
              belongs to, and to the stream picker when we do not — a room
              stored before the namespace was recorded still gets a way back
              rather than a dead control. */}
          <button
            type="button"
            className={styles.backBtn}
            onClick={leave}
            data-testid="back-to-rooms"
            title={
              namespaceId ? "Back to the room list" : "Back to your streams"
            }
          >
            <ChevronLeftIcon size={16} />
            {backLabel}
          </button>
          <span className={styles.divider} aria-hidden="true" />
          <BrandMark size={24} />
          <div className={styles.roomText}>
            <h1 className={styles.title} title={stream.contextId ?? ""}>
              {roomName ||
                (stream.contextId
                  ? `Room ${stream.contextId.slice(0, 6)}`
                  : "No room")}
            </h1>
          </div>
          <span
            className={`${styles.slotsPill} ${s.slots.full ? styles.slotsPillFull : ""}`}
            data-testid="slots-readout"
            data-occupied={s.slots.occupied}
            data-free={s.slots.free}
            title={`${s.slots.occupied} of ${MAX_BROADCASTERS} broadcast slots in use`}
          >
            <span
              className={`${styles.dot} ${s.slots.occupied > 0 ? styles.dotLive : ""}`}
            />
            {s.slots.occupied}/{MAX_BROADCASTERS} broadcasting
            {!s.running && s.slots.full ? " · spectating" : ""}
          </span>
          <CallTimer className={styles.timer} />
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

      <div className={styles.stageWrap}>
        <div className={styles.notices}>
          {s.supported === false && (
            <div
              className={`${styles.banner} ${styles.bannerError}`}
              data-testid="unsupported"
              role="alert"
            >
              <AlertTriangleIcon size={18} className={styles.bannerIcon} />
              <span className={styles.bannerText}>
                This browser has no WebCodecs <code>VideoEncoder</code>. Chrome
                or Edge works; Safari needs 16.4+. You can still spectate —
                decoding is unaffected — but you cannot broadcast.
              </span>
            </div>
          )}
          {s.yielded && (
            <div
              className={`${styles.banner} ${styles.bannerWarn}`}
              data-testid="yielded-notice"
              role="status"
            >
              <AlertTriangleIcon size={18} className={styles.bannerIcon} />
              <span className={styles.bannerText}>
                <strong>
                  All {MAX_BROADCASTERS} broadcast slots were taken, so your
                  camera stopped.
                </strong>{" "}
                Someone else started before you did. You are still receiving
                everyone — &quot;Go live&quot; re-enables itself as soon as a
                slot frees up.
              </span>
              <button
                type="button"
                className={styles.bannerClose}
                onClick={s.clearYielded}
                aria-label="Dismiss"
              >
                <XIcon size={16} />
              </button>
            </div>
          )}
          {/* Measured, not defensive: a second broadcaster loses roughly 40% of
              its frames on this transport, and no client-side pacing fixes it.
              Saying so is better than letting someone conclude their camera or
              network is broken. A compact chip, not an essay over the video:
              the full explanation is one click away in Call details. */}
          {s.slots.occupied >= DEGRADED_FROM_BROADCASTERS && (
            <div
              className={`${styles.banner} ${styles.bannerChip}`}
              data-testid="degraded-notice"
              title={`Frame rate is shared, and this transport delivers about ${DEGRADED_DELIVERY_PERCENT}% of frames with ${DEGRADED_FROM_BROADCASTERS} senders and less beyond that — measured, and not something the app can tune away. One broadcaster at a time is smooth.`}
            >
              <InfoIcon size={16} className={styles.bannerIcon} />
              <span className={styles.bannerText}>
                <strong>
                  {s.slots.occupied} people are broadcasting, so every stream is
                  choppier.
                </strong>
              </span>
              <button
                type="button"
                className={styles.bannerLink}
                onClick={() => setShowData(true)}
              >
                Why?
              </button>
            </div>
          )}
          {s.error && (
            <div
              className={`${styles.banner} ${styles.bannerError}`}
              data-testid="live-error"
              role="alert"
            >
              <AlertTriangleIcon size={18} className={styles.bannerIcon} />
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
              <span className={styles.emptyAvatar} aria-hidden="true">
                {initials(effectiveName)}
              </span>
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

          {/* Local preview. Muted + playsInline: this is the encoder's source,
              not a monitor. It is always mounted — an unmounted <video> loses
              its srcObject, so remounting it on every start/stop would drop the
              camera stream the encoder is reading from — and only shown while
              running. */}
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
            <figcaption
              className={styles.tileLabel}
              title={
                s.slots.myRank !== null ? `slot ${s.slots.myRank + 1}` : ""
              }
            >
              <VideoIcon size={14} className={styles.tileIcon} />
              <span className={styles.tileName}>You</span>
            </figcaption>
          </figure>

          {/* One tile PER REMOTE SENDER. A single canvas fed by a single decoder
              cannot work beyond one sender: each is an independent H.264
              bitstream and interleaving them into one decoder produces an error
              or a smear. */}
          {s.remotePeers.map((peer) => (
            <figure
              key={peer.from}
              className={styles.tile}
              data-testid="peer-tile"
              data-peer={peer.from}
            >
              {/* STABLE ref callback, memoized per peer. An inline
                  `ref={(el) => attach(peer.from, el)}` is a NEW function on
                  every render, so React detaches (null) and reattaches on each
                  one — and the detach path closes that peer's decoder. Since the
                  stats tick re-renders every second, the decoder was destroyed
                  every second and each peer only ever decoded the keyframe after
                  it. */}
              <canvas
                ref={peerCanvasRef(peer.from)}
                className={styles.media}
                data-testid="remote-canvas"
                data-peer={peer.from}
              />
              {!peer.decoding && (
                <span className={styles.tileWaiting}>
                  <span className={styles.spinner} aria-hidden="true" />
                  waiting for a keyframe…
                </span>
              )}
              <figcaption
                className={styles.tileLabel}
                title={`${peer.width}×${peer.height}`}
              >
                <VideoIcon size={14} className={styles.tileIcon} />
                <span className={styles.tileName}>
                  {names[peer.from] ?? shortId(peer.from)}
                </span>
              </figcaption>
            </figure>
          ))}
        </main>

        <footer className={styles.controls}>
          {s.running ? (
            <button
              type="button"
              className={`${styles.roundBtn} ${styles.roundBtnOn}`}
              data-testid="capture-toggle"
              data-running={s.running}
              onClick={() => s.stop()}
              title="Stop broadcasting"
            >
              <VideoIcon size={20} />
              <span className={styles.srOnly}>Stop broadcasting</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.goLiveBtn}
              data-testid="capture-toggle"
              data-running={s.running}
              onClick={() => s.start()}
              disabled={!canGoLive}
              title={
                !joined
                  ? "Joining the room…"
                  : s.slots.full
                    ? `All ${MAX_BROADCASTERS} broadcast slots are taken`
                    : "Share your camera with the room"
              }
            >
              <VideoOffIcon size={18} />
              Go live
            </button>
          )}

          <button
            type="button"
            className={styles.roundBtn}
            onClick={() => setShowPeople(true)}
            data-testid="people-toggle"
            title="People"
          >
            <UsersIcon size={20} />
            <span className={styles.countBadge} aria-hidden="true">
              {people.length}
            </span>
            <span className={styles.srOnly}>People · {people.length}</span>
          </button>

          <button
            type="button"
            className={styles.roundBtn}
            onClick={() => setShowData(true)}
            data-testid="details-toggle"
            title="Call details and statistics"
          >
            <InfoIcon size={20} />
            <span className={styles.srOnly}>See more data</span>
          </button>

          <MoreMenu
            onDetails={() => setShowData(true)}
            onPeople={() => setShowPeople(true)}
            onBack={leave}
            backLabel={`Back to ${backLabel.toLowerCase()}`}
          >
            {/* The live strip. Kept in the DOM while the menu is closed — the
                browser e2e reads these `data-value`s — but out of sight: it is
                how you tell a working call from a broken one, not something to
                stare at during one. */}
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
          </MoreMenu>

          <button
            type="button"
            className={styles.leaveBtn}
            onClick={leave}
            title="Leave call"
            aria-label="Leave call"
            data-testid="leave-call"
          >
            <PhoneOffIcon size={20} />
          </button>
        </footer>
      </div>

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

/** Time in the call, from when this page mounted. Presentation only. */
function CallTimer({ className }: { className?: string }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className={className} title="Time in this call">
      {h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`}
    </span>
  );
}

/**
 * The "…" menu: everything that is not the call itself — live health numbers,
 * the full data panel, the roster, the node this session talks to and the way
 * out of it. Open/closed is presentation state only; the children stay mounted
 * so readouts inside keep their `data-value`s for drivers.
 */
function MoreMenu({
  onDetails,
  onPeople,
  onBack,
  backLabel,
  children,
}: {
  onDetails: () => void;
  onPeople: () => void;
  onBack: () => void;
  backLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className={styles.moreRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.roundBtn} ${open ? styles.roundBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        data-testid="more-menu-toggle"
      >
        <MoreHorizontalIcon size={20} />
        <span className={styles.srOnly}>More options</span>
      </button>
      <div
        className={styles.menu}
        role="menu"
        hidden={!open}
        data-testid="more-menu"
      >
        <div className={styles.menuSection}>
          <span className={styles.menuEyebrow}>
            <ActivityIcon size={14} /> Call health
          </span>
          {children}
        </div>
        <div className={styles.menuSep} />
        <button
          type="button"
          role="menuitem"
          className={styles.menuItem}
          onClick={pick(onDetails)}
        >
          <InfoIcon size={16} /> Call details and statistics
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.menuItem}
          onClick={pick(onPeople)}
        >
          <UsersIcon size={16} /> People and your name
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.menuItem}
          onClick={pick(onBack)}
        >
          <ChevronLeftIcon size={16} /> {backLabel}
        </button>
        <div className={styles.menuSep} />
        <SessionMenu variant="menu" />
      </div>
    </div>
  );
}
