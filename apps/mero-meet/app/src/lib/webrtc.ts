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
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

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
   * (which kicks off negotiation); departed peers are torn down.
   */
  syncPeers(roster: string[]): void {
    const wanted = new Set(roster.filter((id) => id !== this.selfId));
    for (const id of wanted) {
      if (!this.peers.has(id)) this.addPeer(id);
    }
    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.closePeer(id, "left roster");
    }
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
    };
    this.peers.set(peerId, state);
    this.diag("peer", `+ peer ${peerId.slice(0, 8)} (polite=${state.polite})`);

    // Publish our tracks — this schedules `negotiationneeded`.
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local!));

    pc.ontrack = (e) => this.cbs.onRemoteStream(peerId, e.streams[0] ?? null);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.diag("signal", `→ ice ${peerId.slice(0, 8)}`);
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
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.diag("signal", `→ offer ${peerId.slice(0, 8)}`);
          this.cbs.onSignal({
            to: peerId,
            kind: "offer",
            payload: JSON.stringify(pc.localDescription),
          });
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
      // Recover dropped connections. "failed" always needs an ICE restart;
      // "disconnected" often self-heals, but a short-fused restart makes
      // reconnection after a peer briefly leaves/rejoins far more reliable.
      if (pc.connectionState === "failed") {
        this.diag("peer", `${peerId.slice(0, 8)} failed → restarting ICE`);
        try { pc.restartIce(); } catch { /* pc may be closing */ }
      } else if (pc.connectionState === "disconnected") {
        setTimeout(() => {
          if (this.peers.get(peerId) === state && pc.connectionState === "disconnected") {
            this.diag("peer", `${peerId.slice(0, 8)} still disconnected → restarting ICE`);
            try { pc.restartIce(); } catch { /* pc may be closing */ }
          }
        }, 2500);
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
    // Update the local stream we expose to the UI.
    if (this.local) {
      this.local.getVideoTracks().forEach((t) => this.local!.removeTrack(t));
      if (track) this.local.addTrack(track);
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
          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.cbs.onSignal({
              to: from,
              kind: "answer",
              payload: JSON.stringify(pc.localDescription),
            });
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
