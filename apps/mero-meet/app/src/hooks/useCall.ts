import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { CallEngine, type OutSignal, type DiagEntry, type PeerStat } from "../lib/webrtc";
import { getExecutorPublicKey } from "../lib/session";
import { invokeTauri } from "../lib/tauri";
import { useMeroMeet } from "./useMeroMeet";

const MAX_DIAG = 200;

/** A remote participant's live stream (or null while connecting). */
export interface RemoteParticipant {
  memberId: string;
  stream: MediaStream | null;
  state: RTCPeerConnectionState;
}

interface UseCallResult {
  localStream: MediaStream | null;
  remotes: RemoteParticipant[];
  muted: boolean;
  videoOn: boolean;
  callId: string | null;
  joining: boolean;
  error: string | null;
  toggleMute: () => void;
  toggleVideo: () => void;
  leave: () => Promise<void>;
  // Developer-mode diagnostics (never surfaced to normal users).
  diagnostics: DiagEntry[];
  getStats: () => Promise<PeerStat[]>;
}

const SIGNAL_POLL_MS = 2000;
const HEARTBEAT_MS = 10_000;

/**
 * Drives one active call. On mount it acquires media, joins the call session,
 * and reconciles WebRTC peer connections against the contract's call roster.
 * Signaling rides the contract: outbound via `post_signal`, inbound drained by
 * `get_signals` (nudged by SSE `SignalPosted`, with a poll fallback).
 */
export function useCall(onLeft: () => void): UseCallResult {
  const meet = useMeroMeet();
  const selfId = getExecutorPublicKey() ?? "";

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Map<string, RemoteParticipant>>(new Map());
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  const [callId, setCallId] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagEntry[]>([]);

  const engineRef = useRef<CallEngine | null>(null);
  const callIdRef = useRef<string>("");
  const lastSeqRef = useRef<number>(0);
  const drainingRef = useRef<boolean>(false);

  const updateRemote = useCallback((id: string, patch: Partial<RemoteParticipant>) => {
    setRemotes((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { memberId: id, stream: null, state: "new" as RTCPeerConnectionState };
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }, []);

  // ── Outbound signaling: engine → contract ──────────────────────────────────
  const sendSignal = useCallback(
    (sig: OutSignal) => {
      void meet.postSignal(sig.to, sig.kind, sig.payload, callIdRef.current);
    },
    [meet],
  );

  // ── Inbound signaling: contract → engine ────────────────────────────────────
  const drainSignals = useCallback(async () => {
    if (drainingRef.current || !engineRef.current) return;
    drainingRef.current = true;
    try {
      const signals = await meet.getSignals(lastSeqRef.current);
      for (const s of signals ?? []) {
        if (s.seq > lastSeqRef.current) lastSeqRef.current = s.seq;
        await engineRef.current.handleSignal(s.from, s.kind, s.payload);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [meet]);

  // ── Roster reconciliation ───────────────────────────────────────────────────
  const syncRoster = useCallback(async () => {
    if (!engineRef.current) return;
    const roster = await meet.getCallParticipants();
    if (roster) engineRef.current.syncPeers(roster);
  }, [meet]);

  // ── Mount: acquire media + join the call ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const engine = new CallEngine(selfId, {
      onLocalStream: (s) => !cancelled && setLocalStream(s),
      onRemoteStream: (id, stream) => updateRemote(id, { stream }),
      onSignal: sendSignal,
      onPeerStateChange: (id, state) => updateRemote(id, { state }),
      onDiag: (entry) =>
        setDiagnostics((prev) => {
          const next = prev.length >= MAX_DIAG ? prev.slice(prev.length - MAX_DIAG + 1) : prev;
          return [...next, entry];
        }),
    });
    engineRef.current = engine;

    (async () => {
      try {
        // Pull ICE/TURN config bundled by the desktop app (falls back to the
        // engine's built-in STUN if the command isn't available).
        const ice = await invokeTauri<RTCIceServer[]>("get_ice_servers");
        if (ice && ice.length) engine.setIceServers(ice);

        await engine.start();
        const id = await meet.startCall();
        if (cancelled) return;
        callIdRef.current = id ?? "";
        setCallId(id ?? null);
        await syncRoster();
        await drainSignals();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "could not start the call");
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
      engine.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to SSE events (snappy) ────────────────────────────────────────────
  const onEvent = useCallback(
    (evt: { contextId: string; data: unknown }) => {
      const data = evt.data as Record<string, unknown> | null;
      const type = data && typeof data === "object" ? Object.keys(data)[0] : "";
      if (type === "SignalPosted") void drainSignals();
      if (type === "CallStarted" || type === "CallEnded" || type === "PresenceChanged" || type === "MemberLeft") {
        void syncRoster();
      }
    },
    [drainSignals, syncRoster],
  );
  useSubscription(meet.contextId ? [meet.contextId] : [], onEvent);

  // ── Poll fallback + heartbeat ────────────────────────────────────────────────
  useEffect(() => {
    const poll = setInterval(() => {
      void drainSignals();
      void syncRoster();
    }, SIGNAL_POLL_MS);
    const hb = setInterval(() => void meet.heartbeat(), HEARTBEAT_MS);
    return () => {
      clearInterval(poll);
      clearInterval(hb);
    };
  }, [drainSignals, syncRoster, meet]);

  // ── Controls ─────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      engineRef.current?.setMuted(next);
      void meet.setState({ muted: next });
      return next;
    });
  }, [meet]);

  const toggleVideo = useCallback(() => {
    setVideoOn((v) => {
      const next = !v;
      engineRef.current?.setVideo(next);
      void meet.setState({ video_on: next });
      return next;
    });
  }, [meet]);

  const leave = useCallback(async () => {
    engineRef.current?.stop();
    await meet.leaveCall();
    onLeft();
  }, [meet, onLeft]);

  const getStats = useCallback(() => engineRef.current?.getStats() ?? Promise.resolve([]), []);

  return {
    localStream,
    remotes: [...remotes.values()],
    muted,
    videoOn,
    callId,
    joining,
    error,
    toggleMute,
    toggleVideo,
    leave,
    diagnostics,
    getStats,
  };
}
