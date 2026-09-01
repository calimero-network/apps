// Aliased over ../../src/hooks/useLiveStream by vite.config.ts. See ../shots.mjs.
//
// Renders the REAL CallPage and DataDialog with fixture data: the components,
// the CSS modules and the slot arithmetic are all production code, and only the
// node and the camera are substituted. That is the whole point — a screenshot of
// a hand-built mock of the UI would prove nothing about the UI.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotView } from "../../src/lib/slots";
import type { RemotePeer } from "../../src/hooks/useLiveStream";
import {
  PEER_NAMES,
  STATS,
  probeFor,
  scenarioById,
  slotsFor,
} from "./fixtures";
import { paintPattern, patternStream } from "./pattern";
import {
  adaptiveEncoding,
  dutyCycle,
  pressure,
  sendBudget,
} from "../../src/lib/capacity";
import { maxPayloadBytes } from "../../src/lib/ephemeralFrames";

export const LIVE_WIDTH = 640;
export const LIVE_HEIGHT = 480;
// Re-exported because the aliased module has to present the same surface the real
// one does — DataDialog imports this for its send-budget arithmetic, and the
// harness build fails loudly when the surface drifts, which is what it is for.
export const KEYFRAME_INTERVAL_MS = 2000;

export type { RemotePeer } from "../../src/hooks/useLiveStream";
export type { LiveController } from "../../src/hooks/useLiveStream";

const scenarioId = new URLSearchParams(location.search).get("s") ?? "idle";

export function useLiveStream(_enabled: boolean) {
  const sc = scenarioById(scenarioId);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [slots] = useState<SlotView>(() => slotsFor(sc));
  const shared = adaptiveEncoding(
    { fps: 25, bitrate: 1_500_000 },
    Math.max(1, slots.occupied),
  );
  const budget = sendBudget({
    ...shared,
    keyframeIntervalMs: KEYFRAME_INTERVAL_MS,
    fragmentPayloadBytes: maxPayloadBytes("avc1.42001f"),
  });
  const probe = probeFor(sc);
  const duty = dutyCycle(budget, probe.encodeMsP50 ?? 0);
  const stops = useRef<(() => void)[]>([]);

  // The self tile is a real <video>; feed it a canvas capture stream so the
  // harness exercises that element rather than swapping in a canvas.
  useEffect(() => {
    if (!sc.running) return;
    const el = localVideoRef.current;
    if (!el) return;
    el.srcObject = patternStream("You", 4);
    el.muted = true;
    void el.play().catch(() => {});
  }, [sc.running]);

  useEffect(() => () => stops.current.forEach((fn) => fn()), []);

  const attachPeerCanvas = useCallback(
    (from: string, el: HTMLCanvasElement | null) => {
      if (!el) return;
      const i = sc.remotes.indexOf(from);
      stops.current.push(paintPattern(el, PEER_NAMES[from] ?? from, i));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const remotePeers: RemotePeer[] = sc.remotes.map((from, i) => ({
    from,
    startedAtMs: 1_700_000_000_000 + i,
    width: LIVE_WIDTH,
    height: LIVE_HEIGHT,
    framesDecoded: 4210 + i * 37,
    decoding: true,
  }));

  const noop = useCallback(() => {}, []);

  return {
    localVideoRef,
    remotePeers,
    attachPeerCanvas,
    running: sc.running,
    start: noop,
    stop: noop,
    slots,
    yielded: Boolean(sc.yielded),
    clearYielded: noop,
    fps: 25,
    setFps: noop,
    bitrate: 1_500_000,
    setBitrate: noop,
    effectiveBitrate: shared.bitrate,
    // The rate the app would actually capture at, given how many are live —
    // shown on the strip, so a fixture must not report the ceiling.
    effectiveFps: shared.fps,
    // The hook computes this once so the strip and the dialog cannot drift; the
    // mock has to present the same field or neither panel renders — and it has to
    // use the SHARED bitrate, not the ceiling. Feeding a shared fps with an
    // unshared bitrate is the exact combination the ladder measured as worse
    // (7-fragment keyframes), so a screenshot built that way would advertise a
    // configuration the app deliberately does not use.
    budget,
    // Derived in the hook now, so both panels read one value; the mock has to
    // present them or neither renders.
    duty,
    load: pressure(duty),
    stats: STATS,
    refreshStats: noop,
    probe,
    downloadCsv: noop,
    resetProbe: noop,
    supported: true as boolean | null,
    error: sc.error ?? null,
  };
}
