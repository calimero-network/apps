// CallEngine tests against a scripted fake RTCPeerConnection. The fake mirrors
// the small slice of the WebRTC surface the engine touches (negotiation events,
// descriptions, gathering, connection state) so the engine's protocol logic —
// perfect negotiation, non-trickle bundling, roster grace, ghost-peer rebuild —
// is exercised without a browser media stack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallEngine, type OutSignal } from "./webrtc";

// ── Fakes ─────────────────────────────────────────────────────────────────────

class FakeTrack {
  enabled = true;
  stop = vi.fn();
  constructor(
    public kind: "audio" | "video",
    public label = `${kind}-track`,
  ) {}
  getSettings() {
    return { width: 640, height: 480, frameRate: 30 };
  }
}

class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

type Desc = { type: "offer" | "answer"; sdp: string };

class FakePC {
  static all: FakePC[] = [];
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  signalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { streams: unknown[] }) => void) | null = null;
  onnegotiationneeded: (() => void | Promise<void>) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  restartIce = vi.fn();
  closed = false;
  private senders: { track: unknown; replaceTrack: ReturnType<typeof vi.fn> }[] = [];
  private negotiationQueued = false;

  constructor(public config: unknown) {
    FakePC.all.push(this);
  }
  addTrack(track: unknown) {
    const s = { track, replaceTrack: vi.fn(async (t: unknown) => void (s.track = t)) };
    this.senders.push(s);
    // Browsers coalesce negotiationneeded across addTrack calls.
    if (!this.negotiationQueued) {
      this.negotiationQueued = true;
      queueMicrotask(() => {
        this.negotiationQueued = false;
        void this.onnegotiationneeded?.();
      });
    }
    return s;
  }
  getSenders() {
    return this.senders;
  }
  async setLocalDescription(desc?: Desc) {
    const answering = this.remoteDescription?.type === "offer";
    this.localDescription = desc ?? { type: answering ? "answer" : "offer", sdp: "sdp" };
    this.signalingState = answering ? "stable" : "have-local-offer";
  }
  async setRemoteDescription(desc: Desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(_c: unknown) {}
  addEventListener(_e: string, _f: () => void) {}
  removeEventListener(_e: string, _f: () => void) {}
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  /** Test helper: drive connectionState + fire the handler. */
  setConn(s: RTCPeerConnectionState) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}

async function flush(turns = 12) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

// ── Harness ───────────────────────────────────────────────────────────────────

// selfId chosen so politeness is deterministic per peer:
//   vs "aaa…": "mmm" > "aaa" → we are POLITE; vs "zzz…": we are IMPOLITE.
const SELF = "mmm-self";
const PEER_POLITE = "aaa-peer";
const PEER_IMPOLITE = "zzz-peer";

function makeEngine() {
  const signals: OutSignal[] = [];
  const cbs = {
    onLocalStream: vi.fn(),
    onRemoteStream: vi.fn(),
    onSignal: vi.fn((s: OutSignal) => signals.push(s)),
    onPeerStateChange: vi.fn(),
    onDiag: vi.fn(),
  };
  const engine = new CallEngine(SELF, cbs);
  return { engine, cbs, signals };
}

async function peerCount(engine: CallEngine): Promise<number> {
  return (await engine.getStats()).length;
}

beforeEach(() => {
  FakePC.all = [];
  vi.stubGlobal("RTCPeerConnection", FakePC);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => new FakeMediaStream([new FakeTrack("audio"), new FakeTrack("video")])),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("negotiation", () => {
  it("publishes tracks and sends ONE offer with ICE bundled (gathering already complete)", async () => {
    const { engine, signals } = makeEngine();
    await engine.start();
    engine.syncPeers([SELF, PEER_POLITE]);
    await flush();

    const offers = signals.filter((s) => s.kind === "offer");
    expect(offers).toHaveLength(1);
    expect(offers[0].to).toBe(PEER_POLITE);
    expect(JSON.parse(offers[0].payload).type).toBe("offer");
    // Non-trickle: no separate ice signals raced alongside the offer.
    expect(signals.filter((s) => s.kind === "ice")).toHaveLength(0);
  });

  it("answers an inbound offer (ICE bundled) and creates the peer on demand", async () => {
    const { engine, signals } = makeEngine();
    await engine.handleSignal(PEER_POLITE, "offer", JSON.stringify({ type: "offer", sdp: "x" }));
    await flush();

    const answers = signals.filter((s) => s.kind === "answer");
    expect(answers).toHaveLength(1);
    expect(answers[0].to).toBe(PEER_POLITE);
    expect(await peerCount(engine)).toBe(1);
  });

  it("trickles only LATE candidates (after the SDP was posted)", async () => {
    const { engine, signals } = makeEngine();
    await engine.handleSignal(PEER_POLITE, "offer", JSON.stringify({ type: "offer", sdp: "x" }));
    await flush();
    const pc = FakePC.all[0];

    pc.onicecandidate?.({ candidate: { candidate: "late-c" } });
    const ice = signals.filter((s) => s.kind === "ice");
    expect(ice).toHaveLength(1);
    expect(JSON.parse(ice[0].payload).candidate).toBe("late-c");
  });

  it("impolite side ignores a glare offer; polite side yields and answers", async () => {
    const { engine, signals } = makeEngine();

    // Impolite (vs zzz): mid-own-offer, inbound offer must be ignored.
    await engine.handleSignal(PEER_IMPOLITE, "bye", ""); // no-op warm-up
    await engine.handleSignal(PEER_IMPOLITE, "offer", JSON.stringify({ type: "offer", sdp: "x" }));
    await flush();
    // First offer processed normally (no collision yet) → answer sent.
    expect(signals.filter((s) => s.to === PEER_IMPOLITE && s.kind === "answer")).toHaveLength(1);

    // Now force a collision: pretend we're mid-offer, then an offer lands.
    const pc = FakePC.all[FakePC.all.length - 1];
    pc.signalingState = "have-local-offer";
    signals.length = 0;
    await engine.handleSignal(PEER_IMPOLITE, "offer", JSON.stringify({ type: "offer", sdp: "y" }));
    await flush();
    expect(signals).toHaveLength(0); // ignored — impolite never answers glare

    // Polite (vs aaa): same collision is processed (rollback semantics).
    await engine.handleSignal(PEER_POLITE, "offer", JSON.stringify({ type: "offer", sdp: "x" }));
    await flush();
    const politePc = FakePC.all[FakePC.all.length - 1];
    politePc.signalingState = "have-local-offer";
    signals.length = 0;
    await engine.handleSignal(PEER_POLITE, "offer", JSON.stringify({ type: "offer", sdp: "y" }));
    await flush();
    expect(signals.filter((s) => s.kind === "answer")).toHaveLength(1);
  });
});

describe("roster reconciliation", () => {
  it("keeps a peer through short roster gaps and closes it after the miss limit", async () => {
    const { engine, cbs } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    expect(await peerCount(engine)).toBe(1);

    engine.syncPeers([]); // miss 1
    engine.syncPeers([]); // miss 2
    expect(await peerCount(engine)).toBe(1);
    expect(FakePC.all[0].closed).toBe(false);

    engine.syncPeers([]); // miss 3 → closed
    expect(await peerCount(engine)).toBe(0);
    expect(FakePC.all[0].closed).toBe(true);
    expect(cbs.onRemoteStream).toHaveBeenCalledWith(PEER_POLITE, null);
  });

  it("a reappearing peer resets the miss streak", async () => {
    const { engine } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    engine.syncPeers([]); // miss 1
    engine.syncPeers([]); // miss 2
    engine.syncPeers([PEER_POLITE]); // back → streak reset
    engine.syncPeers([]); // miss 1 again
    engine.syncPeers([]); // miss 2 again
    expect(await peerCount(engine)).toBe(1);
  });

  it("bye closes the peer immediately (no grace)", async () => {
    const { engine, cbs } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    await engine.handleSignal(PEER_POLITE, "bye", "");
    expect(await peerCount(engine)).toBe(0);
    expect(cbs.onRemoteStream).toHaveBeenCalledWith(PEER_POLITE, null);
  });

  it("a gossip-stale roster cannot resurrect a peer that said bye", async () => {
    const { engine } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    await engine.handleSignal(PEER_POLITE, "bye", "");
    // The roster hasn't caught up and still lists the departed peer.
    engine.syncPeers([PEER_POLITE]);
    expect(await peerCount(engine)).toBe(0); // stays gone — no junk re-offer
  });

  it("a rejoin offer bypasses the recently-left suppression instantly", async () => {
    const { engine, signals } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    await engine.handleSignal(PEER_POLITE, "bye", "");
    // They come back: a fresh inbound offer re-adds them immediately…
    await engine.handleSignal(PEER_POLITE, "offer", JSON.stringify({ type: "offer", sdp: "x" }));
    await flush();
    expect(await peerCount(engine)).toBe(1);
    expect(signals.filter((s) => s.kind === "answer" && s.to === PEER_POLITE)).toHaveLength(1);
    // …and the roster may list them again without being suppressed.
    engine.syncPeers([PEER_POLITE]);
    expect(await peerCount(engine)).toBe(1);
  });

  it("emits the initial peer state on add so the fast poll engages before the first ICE event", async () => {
    const { engine, cbs } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    expect(cbs.onPeerStateChange).toHaveBeenCalledWith(PEER_POLITE, "new");
  });
});

describe("ghost-peer reconnection ladder", () => {
  it("failed → immediate ICE restart; still down after the window → full rebuild with a fresh handshake", async () => {
    vi.useFakeTimers();
    const { engine, cbs } = makeEngine();
    await engine.start();
    engine.syncPeers([PEER_POLITE]);
    const pc = FakePC.all[0];

    pc.setConn("failed");
    expect(pc.restartIce).toHaveBeenCalledTimes(1);

    // Unhealed for 8s → the wedged pc is torn down and a NEW one negotiates.
    await vi.advanceTimersByTimeAsync(8000);
    expect(pc.closed).toBe(true);
    expect(FakePC.all.length).toBe(2);
    expect(await peerCount(engine)).toBe(1);
    // Rebuild keeps the last frame on the tile ("reconnecting…" overlay) —
    // the stream-cleared callback must NOT fire for a rebuild.
    expect(cbs.onRemoteStream).not.toHaveBeenCalledWith(PEER_POLITE, null);
    // Rebuilt pc published our tracks → fresh offer goes out.
    await vi.advanceTimersByTimeAsync(0);
    const offers = cbs.onSignal.mock.calls.filter(([s]) => (s as OutSignal).kind === "offer");
    expect(offers.length).toBeGreaterThanOrEqual(2);
  });

  it("a connection that heals cancels the rebuild", async () => {
    vi.useFakeTimers();
    const { engine } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    const pc = FakePC.all[0];

    pc.setConn("failed");
    pc.setConn("connected"); // healed before the window elapsed
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pc.closed).toBe(false);
    expect(FakePC.all.length).toBe(1);
  });

  it("disconnected gets the short-fuse ICE restart, then rebuild if still down", async () => {
    vi.useFakeTimers();
    const { engine } = makeEngine();
    engine.syncPeers([PEER_POLITE]);
    const pc = FakePC.all[0];

    pc.setConn("disconnected");
    expect(pc.restartIce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2500);
    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5500); // 8s total since degradation
    expect(pc.closed).toBe(true);
    expect(FakePC.all.length).toBe(2);
    expect(await peerCount(engine)).toBe(1);
  });
});

describe("track replacement (background effects)", () => {
  it("hands the UI a NEW MediaStream and swaps every video sender in place", async () => {
    const { engine, cbs } = makeEngine();
    await engine.start();
    engine.syncPeers([PEER_POLITE]);
    await flush();

    const firstStream = cbs.onLocalStream.mock.calls[0][0];
    const processed = new FakeTrack("video", "processed");
    await engine.replaceVideoTrack(processed as unknown as MediaStreamTrack);

    const lastStream = cbs.onLocalStream.mock.calls.at(-1)![0];
    expect(lastStream).not.toBe(firstStream); // new identity → React re-renders
    expect((lastStream as FakeMediaStream).getVideoTracks()[0]).toBe(processed);

    const videoSender = FakePC.all[0]
      .getSenders()
      .find((s) => (s.track as FakeTrack).kind === "video");
    expect(videoSender?.replaceTrack).toHaveBeenCalledWith(processed);
  });
});
