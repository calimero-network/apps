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
import { writeNotes, type ChatMessage, type NotesModelId } from "../lib/notes";
import type { FromNotesWorker, ToNotesWorker } from "../notes/protocol";
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
  const node = new AudioWorkletNode(ctx, "sylence-tap", { numberOfInputs: 1, numberOfOutputs: 1 });
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
        message: "Your microphone is off for Sylence, so only the other side of the call is transcribed. Allow it in Settings.",
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
  // Only between stretches: loading the next model disposes the current one,
  // which would fail the stretch it is transcribing.
  if (!r.scheduler.working && r.scheduler.behind()) {
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
        if (r.stopping) void drained();
      }
      return;
    }
    case "text": {
      const job = r?.scheduler.done(m.id, m.ms);
      const text = cleanTranscript(m.text);
      if (job && text) void emit({ type: "segment", speaker: job.speaker, startMs: job.startMs, endMs: job.endMs, text, startedAt: r?.startedAt });
      pump();
      return;
    }
    case "transcribeError":
      r?.scheduler.done(m.id, 0);
      void emit({ type: "log", message: `transcription failed: ${m.error}` });
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
  // A model still loading transcribes what was captured once it is ready
  // (`ready` pumps the queue); only a model that cannot load at all ends empty.
  if (r.ready) pump();
  else if (r.scheduler.idle) await drained();
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

// ── notes: a small language model writes the summary and action items ──────

let notesWorker: Worker | null = null;
let notesLoad: { model: NotesModelId; done: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null = null;
const notesJobs = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
let notesNext = 1;
/** The device the notes model runs on; tests set `wasm` (no GPU in headless Chromium). */
const NOTES_DEVICE: "webgpu" | "wasm" = (globalThis as { __SYLENCE_NOTES_DEVICE__?: "webgpu" | "wasm" }).__SYLENCE_NOTES_DEVICE__ ?? "webgpu";

function notes(): Worker {
  if (notesWorker) return notesWorker;
  notesWorker = new Worker(new URL("../notes/worker.ts", import.meta.url), { type: "module" });
  notesWorker.addEventListener("message", (e: MessageEvent<FromNotesWorker>) => {
    const m = e.data;
    if (m.type === "progress") void emit({ type: "notesProgress", model: m.model, fraction: m.fraction, step: "download" });
    else if (m.type === "ready") notesLoad?.resolve();
    else if (m.type === "loadError") notesLoad?.reject(new Error(m.error));
    else {
      const job = notesJobs.get(m.id);
      notesJobs.delete(m.id);
      if (m.type === "text") job?.resolve(m.text);
      else job?.reject(new Error(m.error));
    }
  });
  return notesWorker;
}
const toNotes = (m: ToNotesWorker) => notes().postMessage(m);

function loadNotes(model: NotesModelId): Promise<void> {
  if (notesLoad?.model === model) return notesLoad.done;
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  notesLoad = { model, done, resolve, reject };
  done.catch(() => {
    if (notesLoad?.done === done) notesLoad = null;
  });
  toNotes({ type: "load", model, device: NOTES_DEVICE });
  return done;
}

function generate(messages: ChatMessage[]): Promise<string> {
  const id = notesNext++;
  return new Promise((resolve, reject) => {
    notesJobs.set(id, { resolve, reject });
    toNotes({ type: "generate", id, messages });
  });
}

async function runNotes(model: NotesModelId, lines: { seq: number; speaker: string; text: string }[]): Promise<void> {
  // The service worker sleeps after 30 s without an event; writing can take longer.
  const keepAlive = window.setInterval(() => void emit({ type: "tick" }), 10_000);
  try {
    await loadNotes(model);
    void emit({ type: "notesProgress", model, fraction: 0, step: "write" });
    const result = await writeNotes(lines, { generate }, (done, of) =>
      void emit({ type: "notesProgress", model, fraction: done / of, step: "write" }),
    );
    void emit({ type: "notes", notes: result });
  } catch (e) {
    void emit({ type: "notesError", error: e instanceof Error ? e.message : String(e) });
  } finally {
    clearInterval(keepAlive);
  }
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
    case "preloadNotes":
      void loadNotes(m.model).then(
        () => emit({ type: "notesProgress", model: m.model, fraction: 1, step: "download" }),
        (e: unknown) => emit({ type: "notesError", error: e instanceof Error ? e.message : String(e) }),
      );
      respond(true);
      return false;
    case "notes":
      void runNotes(m.model, m.lines);
      respond(true);
      return false;
  }
});

