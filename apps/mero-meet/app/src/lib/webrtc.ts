// ── CallEngine — the media plane ──────────────────────────────────────────────
//
// A full-mesh WebRTC manager: one RTCPeerConnection per remote peer. It owns
// the camera/mic stream and the peer connections; it does NOT know about
// Calimero. Signaling is delegated to callbacks (`onSignal` out, `handleSignal`
// in) which the call hook wires to the mero-meet contract's post_signal /
// get_signals. This is the seam from RESEARCH-01.md: the contract is the
// (decentralized) signaling channel; the media flows here, peer-to-peer.
//
// Implements MDN's "perfect negotiation" pattern so simultaneous offers (glare)
// resolve deterministically:
//   https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
//
// In the Tauri desktop webview this uses the system WebRTC stack (real ICE/UDP).
// A bundled TURN relay (shipped by tauri-app) can be injected via setIceServers.

export type SignalKind = "offer" | "answer" | "ice" | "bye";

export interface OutSignal {
  to: string;
  kind: SignalKind;
  payload: string;
}

export type DiagLevel = "info" | "signal" | "peer" | "error";

export interface DiagEntry {
  t: number;
  level: DiagLevel;
  msg: string;
}

/** Per-peer connection snapshot for the developer-mode diagnostics overlay. */
export interface PeerStat {
  peerId: string;
  connection: RTCPeerConnectionState;
  ice: RTCIceConnectionState;
  outboundKbps: number;
  inboundKbps: number;
}

export interface CallEngineCallbacks {
  onLocalStream(stream: MediaStream): void;
  onRemoteStream(peerId: string, stream: MediaStream | null): void;
  onSignal(sig: OutSignal): void;
  onPeerStateChange?(peerId: string, state: RTCPeerConnectionState): void;
  /** Developer-mode only: structured diagnostics. Never shown to normal users. */
  onDiag?(entry: DiagEntry): void;
}

interface PeerState {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Consecutive roster syncs this peer has been absent from (see syncPeers). */
  missingStreak: number;
  /**
   * True once the current local description has been posted. Candidates
   * gathered before that are bundled into the SDP; the rare straggler that
   * arrives after the gathering cap is trickled individually so it isn't lost.
   */
  sdpSent: boolean;
  /** Armed while the connection is degraded; fires a from-scratch rebuild. */
  rebuildTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

/**
 * How many consecutive roster syncs a peer may be absent before we tear it
 * down. The call roster (call_participants) converges via CRDT gossip, so a
 * peer whose OFFER reached us can easily be missing from our roster view for a
 * few seconds — closing them immediately (the old behaviour) cancelled
 * handshakes mid-flight and connections churned instead of completing.
 */
const ROSTER_MISS_LIMIT = 3;

/**
 * Cap on waiting for ICE gathering before sending an offer/answer. With a
 * STUN+TURN config gathering completes well under this; the cap just ensures a
 * pathological interface list can't stall the handshake.
 */
const ICE_GATHER_TIMEOUT_MS = 2000;

/**
 * If a connection stays degraded (disconnected/failed) this long despite ICE
 * restarts, the RTCPeerConnection is presumed wedged: tear it down and rebuild
 * from scratch (fresh pc, fresh offer/answer). restartIce() reuses transport
 * state that can itself be the problem after a long network drop; a clean
 * rebuild is the reliable reconnect of last resort.
 */
const REBUILD_AFTER_MS = 8000;

export class CallEngine {
  private readonly selfId: string;
  private readonly cbs: CallEngineCallbacks;
  private local: MediaStream | null = null;
  private peers = new Map<string, PeerState>();
  private iceServers: RTCIceServer[] = DEFAULT_ICE;

  // Previous getStats byte counters, for kbps deltas in the diagnostics panel.
  private prevBytes = new Map<string, { out: number; in: number; t: number }>();

  constructor(selfId: string, cbs: CallEngineCallbacks) {
    this.selfId = selfId;
    this.cbs = cbs;
  }

  private diag(level: DiagLevel, msg: string): void {
    this.cbs.onDiag?.({ t: Date.now(), level, msg });
  }

  /** Inject TURN/STUN servers (e.g. the relay bundled by tauri-app). */
  setIceServers(servers: RTCIceServer[]): void {
    this.iceServers = servers.length ? servers : DEFAULT_ICE;
    this.diag("info", `ice servers: ${servers.map((s) => s.urls).join(", ")}`);
  }

  /**
   * Developer-mode only: snapshot each peer connection (state + throughput).
   * Pulled on an interval by the diagnostics overlay; no effect on the call.
   */
  async getStats(): Promise<PeerStat[]> {
    const out: PeerStat[] = [];
    for (const [peerId, { pc }] of this.peers) {
      let bytesOut = 0;
      let bytesIn = 0;
      try {
        const report = await pc.getStats();
        report.forEach((s) => {
          if (s.type === "outbound-rtp") bytesOut += (s as { bytesSent?: number }).bytesSent ?? 0;
          if (s.type === "inbound-rtp") bytesIn += (s as { bytesReceived?: number }).bytesReceived ?? 0;
        });
      } catch {
        /* getStats may reject while connecting */
      }
      const now = Date.now();
      const prev = this.prevBytes.get(peerId);
      const dt = prev ? (now - prev.t) / 1000 : 0;
      const outKbps = prev && dt > 0 ? ((bytesOut - prev.out) * 8) / 1000 / dt : 0;
      const inKbps = prev && dt > 0 ? ((bytesIn - prev.in) * 8) / 1000 / dt : 0;
      this.prevBytes.set(peerId, { out: bytesOut, in: bytesIn, t: now });
      out.push({
        peerId,
        connection: pc.connectionState,
        ice: pc.iceConnectionState,
        outboundKbps: Math.max(0, Math.round(outKbps)),
        inboundKbps: Math.max(0, Math.round(inKbps)),
      });
    }
    return out;
  }

  /** Acquire camera + mic and publish the local stream. */
  async start(): Promise<MediaStream> {
    if (this.local) return this.local;
    this.local = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    const v = this.local.getVideoTracks()[0]?.getSettings();
    this.diag(
      "info",
      `local media acquired — cam ${v?.width ?? "?"}×${v?.height ?? "?"}@${Math.round(v?.frameRate ?? 0)}fps, mic ${this.local.getAudioTracks().length ? "on" : "none"}`,
    );
    this.cbs.onLocalStream(this.local);
    return this.local;
  }

  /** Toggle the local mic. Returns the new muted state. */
  setMuted(muted: boolean): void {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Toggle the local camera. */
  setVideo(on: boolean): void {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  /**
   * Reconcile the peer set against the call roster. New peers get a connection
   * (which kicks off negotiation). Departed peers are torn down only after
   * being absent for {@link ROSTER_MISS_LIMIT} consecutive syncs: our roster
   * view converges via CRDT gossip and routinely lags a peer's own join (their
   * offer often arrives first), so an immediate close would cancel handshakes
   * mid-flight. A `bye` signal still closes instantly (see handleSignal).
   */
  syncPeers(roster: string[]): void {
    const wanted = new Set(roster.filter((id) => id !== this.selfId));
    for (const id of wanted) {
      const existing = this.peers.get(id);
      if (existing) existing.missingStreak = 0;
      else this.addPeer(id);
    }
    for (const [id, state] of [...this.peers.entries()]) {
      if (wanted.has(id)) continue;
      state.missingStreak += 1;
      if (state.missingStreak >= ROSTER_MISS_LIMIT) {
        this.closePeer(id, "left roster");
      } else {
        this.diag("peer", `${id.slice(0, 8)} missing from roster (${state.missingStreak}/${ROSTER_MISS_LIMIT})`);
      }
    }
  }

  /**
   * Wait until ICE gathering finishes (or the cap elapses) so the local
   * description carries ALL candidates inline — non-trickle ICE.
   *
   * Our signaling channel is a CRDT contract replicated over gossip: every
   * message costs a contract write plus node-to-node propagation (seconds, not
   * milliseconds). Trickled candidates meant ~10 extra writes per peer racing
   * the offer they belong to. Bundling makes the whole handshake exactly two
   * messages (offer → answer), which is dramatically faster AND more reliable
   * over this transport.
   */
  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
      function check() {
        if (pc.iceGatheringState === "complete") done();
      }
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  private addPeer(peerId: string): PeerState {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // Politeness must differ across a pair; a string compare is deterministic
    // and symmetric, so exactly one side is polite.
    const state: PeerState = {
      pc,
      polite: this.selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      missingStreak: 0,
      sdpSent: false,
      rebuildTimer: null,
    };
    this.peers.set(peerId, state);
    this.diag("peer", `+ peer ${peerId.slice(0, 8)} (polite=${state.polite})`);

    // Publish our tracks — this schedules `negotiationneeded`.
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local!));

    pc.ontrack = (e) => this.cbs.onRemoteStream(peerId, e.streams[0] ?? null);

    // Candidates gathered before the SDP is posted ride inside it (non-trickle,
    // see waitForIceGathering). Only a straggler past the gathering cap is
    // trickled individually, so slow TURN allocations still make it across.
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && state.sdpSent) {
        this.diag("signal", `→ ice ${peerId.slice(0, 8)} (late)`);
        this.cbs.onSignal({
          to: peerId,
          kind: "ice",
          payload: JSON.stringify(candidate),
        });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        state.sdpSent = false;
        await pc.setLocalDescription();
        await this.waitForIceGathering(pc);
        if (pc.localDescription) {
          this.diag("signal", `→ offer ${peerId.slice(0, 8)} (ice bundled)`);
          this.cbs.onSignal({
            to: peerId,
            kind: "offer",
            payload: JSON.stringify(pc.localDescription),
          });
          state.sdpSent = true;
        }
      } catch {
        /* negotiation will be retried on the next event */
      } finally {
        state.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      this.diag("peer", `${peerId.slice(0, 8)} → ${pc.connectionState}`);
      this.cbs.onPeerStateChange?.(peerId, pc.connectionState);
      const st = pc.connectionState;

      if (st === "connected") {
        // Healed — stand down the rebuild.
        state.missingStreak = 0;
        if (state.rebuildTimer) {
          clearTimeout(state.rebuildTimer);
          state.rebuildTimer = null;
        }
        return;
      }

      // Recovery ladder for degraded connections:
      //  1. "failed" → immediate ICE restart; "disconnected" often self-heals,
      //     so it gets a 2.5s fuse before the restart.
      //  2. If still degraded after REBUILD_AFTER_MS, the pc is presumed wedged
      //     (a ghost/half-dead transport): rebuild the peer from scratch, which
      //     runs a brand-new offer/answer handshake.
      if (st === "failed") {
        this.diag("peer", `${peerId.slice(0, 8)} failed → restarting ICE`);
        try { pc.restartIce(); } catch { /* pc may be closing */ }
      } else if (st === "disconnected") {
        setTimeout(() => {
          if (this.peers.get(peerId) === state && pc.connectionState === "disconnected") {
            this.diag("peer", `${peerId.slice(0, 8)} still disconnected → restarting ICE`);
            try { pc.restartIce(); } catch { /* pc may be closing */ }
          }
        }, 2500);
      }
      if ((st === "failed" || st === "disconnected") && !state.rebuildTimer) {
        state.rebuildTimer = setTimeout(() => {
          state.rebuildTimer = null;
          if (this.peers.get(peerId) !== state) return; // already rebuilt/left
          const cur = pc.connectionState;
          if (cur !== "failed" && cur !== "disconnected") return; // healed/healing
          this.diag(
            "peer",
            `${peerId.slice(0, 8)} unreachable for ${REBUILD_AFTER_MS / 1000}s — rebuilding connection from scratch`,
          );
          this.closePeer(peerId, "rebuilding");
          this.addPeer(peerId);
        }, REBUILD_AFTER_MS);
      }
    };

    return state;
  }

  /**
   * Swap the published video track on every peer (and the local stream) without
   * renegotiating — used to turn camera background effects on/off mid-call.
   * `replaceTrack` is transparent to the remote peer (no new SDP).
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    // Update the local stream we expose to the UI. Hand the UI a NEW
    // MediaStream instance: React state compares by reference (the same object
    // would skip the re-render entirely) and WebKit does not reliably refresh a
    // <video> whose srcObject had tracks swapped in place — both made the local
    // preview keep showing the raw camera after enabling blur.
    if (this.local) {
      this.local.getVideoTracks().forEach((t) => this.local!.removeTrack(t));
      if (track) this.local.addTrack(track);
      this.local = new MediaStream(this.local.getTracks());
      this.cbs.onLocalStream(this.local);
    }
    // Update each peer's outbound video sender in place.
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        try {
          await sender.replaceTrack(track);
        } catch {
          /* sender may be gone if the peer just left */
        }
      }
    }
    this.diag("info", `published video track swapped (${track ? track.label || "processed" : "none"})`);
  }

  /** The live local media stream (raw camera + mic), if started. */
  getLocalStream(): MediaStream | null {
    return this.local;
  }

  /** Feed an inbound signaling message from `from`. */
  async handleSignal(from: string, kind: string, payload: string): Promise<void> {
    this.diag("signal", `← ${kind} ${from.slice(0, 8)}`);
    if (kind === "bye") {
      this.closePeer(from, "bye");
      return;
    }
    const state = this.peers.get(from) ?? this.addPeer(from);
    const { pc } = state;

    try {
      if (kind === "offer" || kind === "answer") {
        const desc = JSON.parse(payload) as RTCSessionDescriptionInit;
        const offerCollision =
          desc.type === "offer" &&
          (state.makingOffer || pc.signalingState !== "stable");
        state.ignoreOffer = !state.polite && offerCollision;
        if (state.ignoreOffer) return;

        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          state.sdpSent = false;
          await pc.setLocalDescription();
          await this.waitForIceGathering(pc);
          if (pc.localDescription) {
            this.diag("signal", `→ answer ${from.slice(0, 8)} (ice bundled)`);
            this.cbs.onSignal({
              to: from,
              kind: "answer",
              payload: JSON.stringify(pc.localDescription),
            });
            state.sdpSent = true;
          }
        }
      } else if (kind === "ice") {
        const candidate = JSON.parse(payload) as RTCIceCandidateInit;
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!state.ignoreOffer) throw err;
        }
      }
    } catch {
      /* drop malformed / out-of-order signal; ICE will recover */
    }
  }

  private closePeer(peerId: string, reason = ""): void {
    const state = this.peers.get(peerId);
    if (!state) return;
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
      state.rebuildTimer = null;
    }
    state.pc.onicecandidate = null;
    state.pc.ontrack = null;
    state.pc.onnegotiationneeded = null;
    state.pc.onconnectionstatechange = null;
    state.pc.close();
    this.peers.delete(peerId);
    this.diag("peer", `- peer ${peerId.slice(0, 8)}${reason ? ` (${reason})` : ""}`);
    this.cbs.onRemoteStream(peerId, null);
  }

  /** Announce departure to peers and tear everything down. */
  stop(): void {
    this.diag("info", `stopping call — saying bye to ${this.peers.size} peer(s)`);
    for (const peerId of this.peers.keys()) {
      this.cbs.onSignal({ to: peerId, kind: "bye", payload: "" });
    }
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId, "call ended");
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
  }
}
