/**
 * The offscreen document: captures the meeting tab (and plays it back, so the
 * call stays audible) and the microphone, cuts speech out of each, and has the
 * speech worker transcribe it. Only text leaves this page, to the service
 * worker.
 */
import tapUrl from "../audio/tap.worklet.ts?worker&url";
import { detectCaps } from "../lib/caps";
import type { OffscreenCommand, OffscreenEvent } from "../lib/messages";
import { Resampler, rms } from "../lib/resample";
import { Scheduler } from "../lib/scheduler";
import { Segmenter } from "../lib/segmenter";
import { cleanTranscript } from "../lib/text";
import { stepDown, type TierId } from "../lib/tiers";
import type { FromWorker, ToWorker } from "../transcribe/protocol";
import type { Speaker } from "../lib/queue";

type Event = OffscreenEvent extends infer E ? (E extends OffscreenEvent ? Omit<E, "source"> : never) : never;
const emit = (e: Event): Promise<unknown> =>
  chrome.runtime.sendMessage({ ...e, source: "offscreen" }).catch(() => undefined);

let worker: Worker | null = null;
function speechWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../transcribe/worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (e: MessageEvent<FromWorker>) => onWorker(e.data));
  return worker;
}
const toWorker = (m: ToWorker, transfer: Transferable[] = []) => speechWorker().postMessage(m, transfer);

interface Recording {
  ctx: AudioContext;
  streams: MediaStream[];
  startedAt: number;
  language: string;
  tier: TierId;
  ready: boolean;
  scheduler: Scheduler;
  segmenters: Map<Speaker, Segmenter>;
  levels: Record<Speaker, number>;
  timers: number[];
  stopping: boolean;
}

let rec: Recording | null = null;

async function tap(ctx: AudioContext, stream: MediaStream, speaker: Speaker, audible: boolean): Promise<void> {
  const source = ctx.createMediaStreamSource(stream);
  // Capturing a tab mutes it; play it back so the call stays audible.
  if (audible) source.connect(ctx.destination);
  const node = new AudioWorkletNode(ctx, "minutes-tap", { numberOfInputs: 1, numberOfOutputs: 1 });
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink).connect(ctx.destination);
  const resampler = new Resampler(ctx.sampleRate);
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const r = rec;
    if (!r) return;
    const block = resampler.push(e.data);
    r.levels[speaker] = Math.max(rms(block), r.levels[speaker] * 0.6);
    const seg = r.segmenters.get(speaker);
    if (!seg || r.stopping) return;
    for (const chunk of seg.push(block)) r.scheduler.enqueue(chunk, speaker);
    pump();
  };
}

async function capture(c: Extract<OffscreenCommand, { type: "capture" }>): Promise<void> {
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(tapUrl);
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: c.streamId } } as unknown as MediaTrackConstraints,
    video: false,
  });
  rec = {
    ctx,
    streams: [tab],
    startedAt: Date.now(),
    language: c.language,
    tier: c.tier,
    ready: false,
    scheduler: new Scheduler(),
    segmenters: new Map([["others", new Segmenter()]]),
    levels: { you: 0, others: 0 },
    timers: [],
    stopping: false,
  };
  await tap(ctx, tab, "others", true);
  if (c.mic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      rec.streams.push(mic);
      rec.segmenters.set("you", new Segmenter());
      await tap(ctx, mic, "you", false);
    } catch {
      void emit({
        type: "notice",
        message: "Your microphone is off for Minutes, so only the other side of the call is transcribed. Allow it in Settings.",
      });
    }
  }
  const r = rec;
  r.timers.push(
    window.setInterval(() => {
      void emit({ type: "levels", you: r.levels.you, others: r.levels.others });
      r.levels.you *= 0.5;
      r.levels.others *= 0.5;
    }, 150),
    window.setInterval(() => void emit({ type: "tick" }), 4_000),
  );
  emit({ type: "model", tier: c.tier, state: "loading", progress: { fraction: 0, file: "" } });
  toWorker({ type: "load", tier: c.tier });
}

function pump(): void {
  const r = rec;
  if (!r || !r.ready) return;
  if (r.scheduler.behind()) {
    const next = stepDown(r.tier, r.language);
    if (next) {
      void emit({ type: "stepDown", from: r.tier, to: next });
      r.tier = next;
      r.ready = false;
      r.scheduler.resetSpeed();
      emit({ type: "model", tier: next, state: "loading", progress: { fraction: 0, file: "" } });
      toWorker({ type: "load", tier: next });
      return;
    }
  }
  const job = r.scheduler.take();
  if (!job) {
    if (r.stopping && r.scheduler.idle) void drained();
    return;
  }
  const audio = job.audio;
  toWorker({ type: "transcribe", id: job.id, audio, language: r.language }, [audio.buffer]);
}

function onWorker(m: FromWorker): void {
  const r = rec;
  switch (m.type) {
    case "progress":
      void emit({ type: "model", tier: m.tier, state: "loading", progress: { fraction: m.fraction, file: m.file } });
      return;
    case "ready":
      void emit({ type: "model", tier: m.tier, state: "ready" });
      if (r && r.tier === m.tier) {
        r.ready = true;
        pump();
      }
      return;
    case "loadError": {
      if (!r) {
        void emit({ type: "model", tier: m.tier, state: "error", error: m.error });
        return;
      }
      // WebGPU can fail (Brave's shields, an old driver): fall to the next model.
      const next = stepDown(m.tier, r.language);
      if (next) {
        void emit({ type: "stepDown", from: m.tier, to: next });
        r.tier = next;
        toWorker({ type: "load", tier: next });
      } else {
        void emit({ type: "model", tier: m.tier, state: "error", error: `The speech model could not load: ${m.error}` });
      }
      return;
    }
    case "text": {
      const job = r?.scheduler.done(m.id, m.ms);
      const text = cleanTranscript(m.text);
      if (job && text) void emit({ type: "segment", speaker: job.speaker, startMs: job.startMs, endMs: job.endMs, text });
      pump();
      return;
    }
    case "transcribeError":
      r?.scheduler.done(m.id, 0);
      pump();
      return;
  }
}

async function stop(): Promise<void> {
  const r = rec;
  if (!r) {
    void emit({ type: "drained", durationMs: 0 });
    return;
  }
  r.stopping = true;
  for (const [speaker, seg] of r.segmenters) for (const chunk of seg.flush()) r.scheduler.enqueue(chunk, speaker);
  for (const s of r.streams) for (const t of s.getTracks()) t.stop();
  if (!r.ready) {
    // No model yet: nothing can be transcribed.
    await drained();
    return;
  }
  pump();
}

let finishing = false;
async function drained(): Promise<void> {
  const r = rec;
  if (!r || finishing) return;
  finishing = true;
  for (const t of r.timers) clearInterval(t);
  await r.ctx.close().catch(() => undefined);
  rec = null;
  finishing = false;
  void emit({ type: "drained", durationMs: Date.now() - r.startedAt });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  const m = message as OffscreenCommand;
  if (m.target !== "offscreen") return false;
  switch (m.type) {
    case "caps":
      void detectCaps().then(respond);
      return true;
    case "capture":
      capture(m).then(
        () => respond(true),
        (e: unknown) => {
          void emit({ type: "captureError", message: `Could not record the tab: ${e instanceof Error ? e.message : String(e)}` });
          respond(false);
        },
      );
      return true;
    case "stop":
      void stop().then(() => respond(true));
      return true;
    case "preload":
      toWorker({ type: "load", tier: m.tier });
      respond(true);
      return false;
  }
});

