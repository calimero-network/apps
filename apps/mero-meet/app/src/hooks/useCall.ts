import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { CallEngine, type OutSignal, type DiagEntry, type PeerStat } from "../lib/webrtc";
import { BackgroundProcessor, type BgEffect } from "../lib/effects";
import { getContextId, getExecutorPublicKey, getUsername, nowSecs } from "../lib/session";
import { GHOST_STALE_SECS, partitionRoster } from "../lib/roster";

// sessionStorage key marking "there is a live call in this room". Set while the
// call is active, cleared by an explicit Leave. sessionStorage survives a page
// REFRESH but not a window close — exactly the semantics we want: F5 mid-call
// auto-rejoins; opening the app fresh does not.
const RESUME_KEY = "mm-call-resume";
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
// While a peer connection is still handshaking, poll this fast — the
// offer/answer roundtrip shouldn't pay poll latency on top of gossip latency.
const SIGNAL_POLL_FAST_MS = 600;
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
  // Gate inbound draining until lastSeq has been seeded to the mailbox head at
  // join. Otherwise the 2s poll / an SSE nudge could drain from lastSeq=0 during
  // the async startup and replay the whole stale mailbox into the fresh engine.
  const seededRef = useRef<boolean>(false);
  const prevLiveRef = useRef<Set<string>>(new Set());
  // Signal ids already fed to the engine. Two nodes can mint the same seq
  // concurrently (next_seq is an LWW register), so we drain with a small seq
  // margin and dedupe by id instead of trusting `seq > lastSeq` alone — that
  // rule silently skipped the second of two equal-seq signals.
  const seenSigIdsRef = useRef<Set<string>>(new Set());
  // Live peer connection states, for the adaptive poll cadence.
  const peerStatesRef = useRef<Map<string, RTCPeerConnectionState>>(new Map());

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
    if (drainingRef.current || !engineRef.current || !seededRef.current) return;
    drainingRef.current = true;
    try {
      // Small seq margin: two nodes can mint the SAME seq concurrently, and the
      // later-gossiped twin would be skipped forever by a strict `> lastSeq`.
      // Re-reading a short window and deduping by id costs one cheap local
      // query and never misses a signal.
      const after = Math.max(0, lastSeqRef.current - 16);
      const signals = await meet.getSignals(after);
      for (const s of signals ?? []) {
        if (s.seq > lastSeqRef.current) lastSeqRef.current = s.seq;
        if (seenSigIdsRef.current.has(s.id)) continue;
        seenSigIdsRef.current.add(s.id);
        if (seenSigIdsRef.current.size > 1024) {
          // Bound the set; ancient ids can't reappear (mailbox is pruned).
          seenSigIdsRef.current = new Set([...seenSigIdsRef.current].slice(-512));
        }
        // NOTE: we deliberately do NOT filter by `s.callId`. `active_call` is an
        // LwwRegister that propagates over CRDT gossip, so two peers joining the
        // same call can briefly hold *different* call ids (each stamps the id its
        // own start_call returned). Filtering on callId dropped the peer's
        // offer/answer/ice during that window → the handshake never completed and
        // no media flowed. The stale-mailbox-replay problem the filter was meant
        // to solve is instead handled at join time by seeding lastSeq to the
        // mailbox head (see the start effect), so a fresh call never re-drains
        // signals from a previous session.
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
      setPresence(presenceMap);
      if (lobby.room?.name) setRoomName(lobby.room.name);
    }
    if (!roster) return;

    // Membership = the call_participants roster, minus ghosts we have POSITIVE
    // evidence for (presence row exists but silent > 60s — crashed/closed
    // without leave_call). A peer with NO presence row is kept: their join just
    // hasn't gossiped in yet, and dropping those tore down handshakes
    // mid-flight. The contract also reaps ghosts on any member's heartbeat;
    // this is the client-side cover until that lands/gossips.
    const { live: liveIds, ghosts } = partitionRoster(roster, presenceMap, selfId, nowSecs());
    for (const id of ghosts) {
      pushDiag(
        "peer",
        `ghost peer ${presenceMap.get(id)?.username || id.slice(0, 8)} dropped — no heartbeat for ${GHOST_STALE_SECS}s (left without saying bye)`,
      );
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
    seededRef.current = false;

    const engine = new CallEngine(selfId, {
      onLocalStream: (s) => !cancelled && setLocalStream(s),
      onRemoteStream: (id, stream) => {
        if (stream === null) {
          // Peer closed. Remove the tile entry instead of upserting a null
          // patch — the upsert re-created a default tile for a peer that had
          // just left, which lingered until the next roster sync pruned it.
          peerStatesRef.current.delete(id);
          setRemotes((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          return;
        }
        updateRemote(id, { stream });
      },
      onSignal: sendSignal,
      onPeerStateChange: (id, state) => {
        peerStatesRef.current.set(id, state);
        updateRemote(id, { state });
      },
      onDiag: (entry) =>
        setDiagnostics((prev) => {
          const next = prev.length >= MAX_DIAG ? prev.slice(prev.length - MAX_DIAG + 1) : prev;
          return [...next, entry];
        }),
    });
    engineRef.current = engine;

    (async () => {
      try {
        pushDiag("info", "joining call — ICE servers + camera + session in parallel…");
        // None of these depend on each other, and each costs real time (ICE
        // endpoint roundtrip, getUserMedia, contract execute, mailbox read) —
        // running them serially added ~1.5-2s to every join.
        const [ice, , id, firstBacklog] = await Promise.all([
          invokeTauri<RTCIceServer[]>("get_ice_servers").catch(() => null),
          engine.start(),
          meet.startCall(),
          meet.getSignals(0),
        ]);
        if (cancelled) return;
        // The seed read is what stops a fresh call from replaying the whole
        // stale mailbox (null = the RPC errored, NOT an empty mailbox) — retry
        // once before accepting a lossy seed.
        let backlog = firstBacklog;
        if (backlog == null) {
          backlog = await meet.getSignals(0);
          if (cancelled) return;
          if (backlog == null) {
            pushDiag("error", "mailbox seed failed twice — old signals may replay briefly");
          }
        }
        if (ice && ice.length) engine.setIceServers(ice);
        else pushDiag("info", "no bundled ICE servers — using default STUN");

        rawVideoTrackRef.current = engine.getLocalStream()?.getVideoTracks()[0] ?? null;
        callIdRef.current = id ?? "";
        setCallId(id ?? null);
        // Seed to the current mailbox head so this fresh call skips every signal
        // already posted (stale offer/ice/bye from a previous session) and only
        // processes NEW ones — the fix for the "won't reconnect after you leave"
        // replay bug. Peers re-offer to us on roster sync, so the history is
        // not needed. Seed the seen-id set too so the drain margin can't replay
        // the newest historical signals.
        lastSeqRef.current = (backlog ?? []).reduce((m, s) => Math.max(m, s.seq), 0);
        seenSigIdsRef.current = new Set((backlog ?? []).map((s) => s.id));
        seededRef.current = true;
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
      seededRef.current = false;
      seenSigIdsRef.current = new Set();
      peerStatesRef.current = new Map();
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
    // Adaptive cadence: while any peer connection is still coming up, poll fast
    // so the offer/answer roundtrip isn't padded with poll latency on top of
    // gossip latency; once everyone is connected (or we're alone), relax to the
    // slow fallback and let SSE nudges carry the urgency.
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      void drainSignals();
      void syncRoster();
      const states = [...peerStatesRef.current.values()];
      const handshaking = states.some((s) => s !== "connected");
      timer = setTimeout(tick, handshaking ? SIGNAL_POLL_FAST_MS : SIGNAL_POLL_MS);
    };
    timer = setTimeout(tick, SIGNAL_POLL_FAST_MS);
    const hb = setInterval(() => void meet.heartbeat(), HEARTBEAT_MS);
    // Best-effort graceful leave if the window is closed/refreshed mid-call
    // (the normal path is the Leave button → leave()). Without this, closing the
    // window leaves your presence.callId set and you linger as a phantom
    // participant for others until your heartbeat goes stale. The contract also
    // reaps a stale call on the next start_call as a backstop.
    const onHide = () => {
      void meet.leaveCall();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(hb);
      window.removeEventListener("pagehide", onHide);
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
    try {
      sessionStorage.removeItem(RESUME_KEY); // explicit leave — do not resume
    } catch { /* blocked storage */ }
    setActive(false); // triggers cleanup effect (engine.stop, processor.close)
    await meet.leaveCall();
  }, [meet, pushDiag]);

  // ── Refresh persistence ───────────────────────────────────────────────────────
  // Mark the live call in sessionStorage (survives F5, dies with the window).
  useEffect(() => {
    if (!active) return;
    const ctx = getContextId();
    if (!ctx) return;
    try {
      sessionStorage.setItem(RESUME_KEY, ctx);
    } catch { /* blocked storage */ }
  }, [active]);

  // On mount (i.e. right after a refresh): if this window had a live call in
  // the current room and we know the user's name, rejoin presence and restart
  // the call automatically — a mid-call F5 used to dead-end in the lobby.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const ctx = getContextId();
    const name = getUsername();
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(RESUME_KEY);
    } catch { /* blocked storage */ }
    if (!ctx || stored !== ctx || !name) return;
    pushDiag("info", "resuming call after page refresh");
    void meet.join(name).then(() => setActive(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
