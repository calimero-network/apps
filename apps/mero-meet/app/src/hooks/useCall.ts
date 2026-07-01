import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { CallEngine, type OutSignal, type DiagEntry, type PeerStat } from "../lib/webrtc";
import { BackgroundProcessor, type BgEffect } from "../lib/effects";
import { getExecutorPublicKey } from "../lib/session";
import { invokeTauri } from "../lib/tauri";
import { useMeroMeet } from "./useMeroMeet";
import type { Presence } from "../types";

const MAX_DIAG = 200;

/** A remote participant, enriched with their lobby presence (name/mute/camera). */
export interface RemoteParticipant {
  memberId: string;
  stream: MediaStream | null;
  state: RTCPeerConnectionState;
  username: string;
  muted: boolean;
  videoOn: boolean;
}

export interface CallController {
  active: boolean;
  localStream: MediaStream | null;
  remotes: RemoteParticipant[];
  muted: boolean;
  videoOn: boolean;
  effect: BgEffect;
  effectBusy: boolean;
  callId: string | null;
  joining: boolean;
  error: string | null;
  roomName: string;
  selfName: string;
  toggleMute: () => void;
  toggleVideo: () => void;
  setEffect: (e: BgEffect) => void;
  start: () => void;
  leave: () => Promise<void>;
  diagnostics: DiagEntry[];
  getStats: () => Promise<PeerStat[]>;
}

const SIGNAL_POLL_MS = 2000;
const HEARTBEAT_MS = 10_000;

/**
 * Drives the (single) active call, independent of which page is showing. Lives in
 * CallProvider so a call survives navigation (enabling the floating mini-call).
 *
 * On {@link start} it acquires media, joins the call session, and reconciles
 * WebRTC peer connections against the contract's call roster. Signaling rides the
 * contract: outbound via `post_signal`, inbound drained by `get_signals` (nudged
 * by SSE `SignalPosted`, with a poll fallback).
 */
export function useCallController(): CallController {
  const meet = useMeroMeet();
  const selfId = getExecutorPublicKey() ?? "";

  const [active, setActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Map<string, RemoteParticipant>>(new Map());
  const [presence, setPresence] = useState<Map<string, Presence>>(new Map());
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(true);
  const [effect, setEffectState] = useState<BgEffect>("none");
  const [effectBusy, setEffectBusy] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagEntry[]>([]);

  const engineRef = useRef<CallEngine | null>(null);
  const processorRef = useRef<BackgroundProcessor | null>(null);
  const rawVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const callIdRef = useRef<string>("");
  const lastSeqRef = useRef<number>(0);
  const drainingRef = useRef<boolean>(false);
  const onlineRef = useRef<Set<string>>(new Set());
  const prevLiveRef = useRef<Set<string>>(new Set());

  // Controller-level diagnostics (roster/effect/lifecycle), interleaved with the
  // engine's own signal/peer logs in the same closable log popup.
  const pushDiag = useCallback((level: DiagEntry["level"], msg: string) => {
    setDiagnostics((prev) => {
      const next = prev.length >= MAX_DIAG ? prev.slice(prev.length - MAX_DIAG + 1) : prev;
      return [...next, { t: Date.now(), level, msg }];
    });
  }, []);

  const updateRemote = useCallback((id: string, patch: Partial<RemoteParticipant>) => {
    setRemotes((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? {
        memberId: id,
        stream: null,
        state: "new" as RTCPeerConnectionState,
        username: "",
        muted: false,
        videoOn: true,
      };
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
        // Drop stale signals from a *previous* call session. Without this, a new
        // call re-drains the whole mailbox (lastSeq resets to 0), replaying old
        // offers/ice/bye into the fresh engine — the "won't reconnect after you
        // leave" bug. Signals carry their call_id, so we can scope precisely.
        if (s.callId && callIdRef.current && s.callId !== callIdRef.current) continue;
        await engineRef.current.handleSignal(s.from, s.kind, s.payload);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [meet]);

  // ── Roster reconciliation ───────────────────────────────────────────────────
  const syncRoster = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    // Pull presence (names + mic/camera + online-ness) and the call roster.
    const [roster, lobby] = await Promise.all([
      meet.getCallParticipants(),
      meet.getLobby(),
    ]);

    const presenceMap = new Map<string, Presence>();
    if (lobby) {
      for (const m of lobby.members) presenceMap.set(m.memberId, m);
      onlineRef.current = new Set(lobby.online);
      setPresence(presenceMap);
      if (lobby.room?.name) setRoomName(lobby.room.name);
    }
    if (!roster) return;

    // Drop ghosts: still listed in the call roster but not seen within the
    // presence TTL (a peer that refreshed/crashed without leaving). Reconnecting
    // to a ghost just spins ICE forever.
    const online = onlineRef.current;
    const liveIds = roster.filter((id) => id === selfId || online.size === 0 || online.has(id));
    for (const id of roster) {
      if (!liveIds.includes(id)) {
        pushDiag("peer", `roster: dropping ghost ${(presenceMap.get(id)?.username) || id.slice(0, 8)} (stale presence)`);
      }
    }
    engine.syncPeers(liveIds);

    // Reconcile the *tile set* to exactly the live remote roster (people actually
    // in the call — NOT everyone in the lobby), enriched with presence. This is
    // what makes the grid scale correctly as people join and leave.
    const liveRemotes = liveIds.filter((id) => id !== selfId);
    const prev = prevLiveRef.current;
    for (const id of liveRemotes) {
      if (!prev.has(id)) pushDiag("peer", `joined: ${(presenceMap.get(id)?.username) || id.slice(0, 8)}`);
    }
    for (const id of prev) {
      if (!liveRemotes.includes(id)) pushDiag("peer", `left: ${id.slice(0, 8)}`);
    }
    if (prev.size !== liveRemotes.length || [...prev].some((id) => !liveRemotes.includes(id))) {
      pushDiag("info", `roster: ${roster.length} in call → ${liveRemotes.length} remote tile(s)`);
    }
    prevLiveRef.current = new Set(liveRemotes);

    setRemotes((prevMap) => {
      const next = new Map<string, RemoteParticipant>();
      for (const id of liveRemotes) {
        const cur =
          prevMap.get(id) ?? {
            memberId: id,
            stream: null,
            state: "new" as RTCPeerConnectionState,
            username: "",
            muted: false,
            videoOn: true,
          };
        const p = presenceMap.get(id);
        next.set(id, p ? { ...cur, username: p.username, muted: p.muted, videoOn: p.videoOn } : cur);
      }
      return next;
    });
  }, [meet, selfId, pushDiag]);

  // ── Start / stop the call machinery when `active` flips ──────────────────────
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setJoining(true);
    setError(null);
    lastSeqRef.current = 0;

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
        pushDiag("info", "joining call — requesting ICE servers…");
        const ice = await invokeTauri<RTCIceServer[]>("get_ice_servers");
        if (ice && ice.length) engine.setIceServers(ice);
        else pushDiag("info", "no bundled ICE servers — using default STUN");

        await engine.start();
        rawVideoTrackRef.current = engine.getLocalStream()?.getVideoTracks()[0] ?? null;
        const id = await meet.startCall();
        if (cancelled) return;
        callIdRef.current = id ?? "";
        setCallId(id ?? null);
        pushDiag("info", `call session: ${id ?? "?"}`);
        await syncRoster();
        await drainSignals();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "could not start the call";
        if (!cancelled) {
          setError(msg);
          pushDiag("error", `join failed: ${msg}`);
        }
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
      engine.stop();
      engineRef.current = null;
      processorRef.current?.close();
      processorRef.current = null;
      // When a background effect is active the raw camera track is detached from
      // the published stream (only the canvas track is), so engine.stop() won't
      // stop it. Stop it explicitly or the camera light stays on after leaving.
      rawVideoTrackRef.current?.stop();
      rawVideoTrackRef.current = null;
      prevLiveRef.current = new Set();
      setLocalStream(null);
      setRemotes(new Map());
      setCallId(null);
      callIdRef.current = "";
      setEffectState("none");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── React to SSE events (snappy) ────────────────────────────────────────────
  const onEvent = useCallback(
    (evt: { contextId: string; data: unknown }) => {
      const data = evt.data as Record<string, unknown> | null;
      const type = data && typeof data === "object" ? Object.keys(data)[0] : "";
      if (type === "SignalPosted") void drainSignals();
      if (
        type === "CallStarted" ||
        type === "CallEnded" ||
        type === "PresenceChanged" ||
        type === "MemberLeft"
      ) {
        void syncRoster();
      }
    },
    [drainSignals, syncRoster],
  );
  useSubscription(active && meet.contextId ? [meet.contextId] : [], onEvent);

  // ── Poll fallback + heartbeat (only while in a call) ─────────────────────────
  useEffect(() => {
    if (!active) return;
    const poll = setInterval(() => {
      void drainSignals();
      void syncRoster();
    }, SIGNAL_POLL_MS);
    const hb = setInterval(() => void meet.heartbeat(), HEARTBEAT_MS);
    return () => {
      clearInterval(poll);
      clearInterval(hb);
    };
  }, [active, drainSignals, syncRoster, meet]);

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

  // ── Background effect (blur) ─────────────────────────────────────────────────
  const setEffect = useCallback((next: BgEffect) => {
    const engine = engineRef.current;
    const raw = rawVideoTrackRef.current;
    if (!engine || !raw) return;
    setEffectBusy(true);
    pushDiag("info", `effect: ${next === "none" ? "disabling background blur" : "enabling background blur…"}`);
    (async () => {
      try {
        if (next === "none") {
          await engine.replaceVideoTrack(raw);
          processorRef.current?.pause();
        } else {
          if (!processorRef.current) processorRef.current = new BackgroundProcessor();
          const input = new MediaStream([raw]);
          const processed = await processorRef.current.start(input, next);
          const track = processed.getVideoTracks()[0] ?? null;
          if (track) await engine.replaceVideoTrack(track);
        }
        setEffectState(next);
        pushDiag("info", `effect: ${next} active`);
      } catch (e) {
        // Segmentation unavailable → stay on the raw camera.
        await engine.replaceVideoTrack(raw).catch(() => {});
        setEffectState("none");
        pushDiag("error", `effect failed (segmenter unavailable): ${e instanceof Error ? e.message : "unknown"}`);
      } finally {
        setEffectBusy(false);
      }
    })();
  }, [pushDiag]);

  const start = useCallback(() => setActive(true), []);

  const leave = useCallback(async () => {
    pushDiag("info", "leaving call");
    setActive(false); // triggers cleanup effect (engine.stop, processor.close)
    await meet.leaveCall();
  }, [meet, pushDiag]);

  const getStats = useCallback(() => engineRef.current?.getStats() ?? Promise.resolve([]), []);

  const selfName = presence.get(selfId)?.username ?? "You";

  const remoteList = useMemo(
    () =>
      [...remotes.values()].map((r) => {
        const p = presence.get(r.memberId);
        return p
          ? { ...r, username: p.username, muted: p.muted, videoOn: p.videoOn }
          : r;
      }),
    [remotes, presence],
  );

  return {
    active,
    localStream,
    remotes: remoteList,
    muted,
    videoOn,
    effect,
    effectBusy,
    callId,
    joining,
    error,
    roomName,
    selfName,
    toggleMute,
    toggleVideo,
    setEffect,
    start,
    leave,
    diagnostics,
    getStats,
  };
}
