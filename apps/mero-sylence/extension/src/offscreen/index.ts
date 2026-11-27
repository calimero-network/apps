/**
 * The offscreen document: captures the meeting tab (and plays it back, so the
 * call stays audible) and the microphone, cuts speech out of each, and has the
 * speech worker transcribe it. The text goes to the service worker; the call's
 * audio, recorded compressed, waits in the extension's storage until the
 * service worker saves it to the workspace (lib/callAudio.ts).
 */
import tapUrl from "../audio/tap.worklet.ts?worker&url";
import { CALL_AUDIO_BITRATE, keepCallAudio, plainMime } from "../lib/callAudio";
import { detectCaps } from "../lib/caps";
import { EchoGate, isMicPhantom, voicedMs } from "../lib/echo";
import { AudioStore, echoOf, inOrder, linesOf, windowsOf, type RedoneLine } from "../lib/improve";
import type { OffscreenCommand, OffscreenEvent } from "../lib/messages";
import { Resampler, rms } from "../lib/resample";
import { Scheduler } from "../lib/scheduler";
import { Segmenter, type Chunk } from "../lib/segmenter";
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
  /** The call's loudness, to tell it leaking into the mic from the user talking. */
  echo: EchoGate;
  /** How long each mic stretch sent to the model was clearly voiced, ms, by job id. */
  voiced: Map<number, number>;
  dropped: { echo: number; phantom: number };
  /** Each source's audio, for the transcript redone after the call. */
  stores: Map<Speaker, AudioStore>;
  /** The call and the mic mixed, recorded compressed, saved to the workspace after Stop. */
  mix: MediaStreamAudioDestinationNode;
  recorder: MediaRecorder | null;
  recorded: Blob[];
}

/** The last recording's audio, kept after it drained for `improve`; gone with this page. */
let kept: { startedAt: number; stores: Map<Speaker, AudioStore> } | null = null;

let rec: Recording | null = null;

async function tap(ctx: AudioContext, stream: MediaStream, speaker: Speaker, audible: boolean, mix?: MediaStreamAudioDestinationNode): Promise<void> {
  const source = ctx.createMediaStreamSource(stream);
  // Into the recording kept for playback (both sides of the call).
  if (mix) source.connect(mix);
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
    if (speaker === "others") r.echo.pushReference(block);
    if (!r.stopping) r.stores.get(speaker)?.push(block);
    const seg = r.segmenters.get(speaker);
    if (!seg || r.stopping) return;
    for (const chunk of seg.push(block)) enqueue(chunk, speaker);
    pump();
  };
}

/**
 * Records the mixed call compressed (Opus), from the recording's start, so the
 * transcript's times line up with it. Where the browser cannot, the call is
 * still transcribed; it is just not kept for playback.
 */
function startRecorder(r: Recording): void {
  const type = ["audio/webm;codecs=opus", "audio/webm"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  if (!type) return;
  try {
    const recorder = new MediaRecorder(r.mix.stream, { mimeType: type, audioBitsPerSecond: CALL_AUDIO_BITRATE });
    recorder.ondataavailable = (e) => {
      if (e.data.size) r.recorded.push(e.data);
    };
    recorder.start(10_000);
    r.recorder = recorder;
  } catch (e) {
    void emit({ type: "log", message: `recorder: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Stops the recorder and keeps the call's audio for the service worker to send. */
async function stopRecorder(r: Recording): Promise<void> {
  const recorder = r.recorder;
  if (!recorder || recorder.state === "inactive") return;
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });
  const blob = new Blob(r.recorded, { type: recorder.mimeType });
  r.recorded = [];
  try {
    await keepCallAudio({ blob, mime: plainMime(recorder.mimeType), durationMs: Date.now() - r.startedAt });
    void emit({ type: "log", message: `recorder: kept ${blob.size} bytes of ${recorder.mimeType}` });
  } catch (e) {
    void emit({ type: "log", message: `recorder: not kept (${e instanceof Error ? e.message : String(e)})` });
  }
}

/** Queues a stretch for the model, unless it is the call leaking into the mic. */
function enqueue(chunk: Chunk, speaker: Speaker): void {
  const r = rec;
  if (!r) return;
  if (speaker === "you" && r.echo.isEcho(chunk.audio, chunk.startMs)) {
    r.dropped.echo++;
    void emit({ type: "log", message: `mic ${chunk.startMs}-${chunk.endMs}ms follows the call: echo, skipped` });
    return;
  }
  const job = r.scheduler.enqueue(chunk, speaker);
  if (speaker === "you") r.voiced.set(job.id, voicedMs(chunk.audio));
}

async function capture(c: Extract<OffscreenCommand, { type: "capture" }>): Promise<void> {
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(tapUrl);
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: c.streamId } } as unknown as MediaTrackConstraints,
    video: false,
  });
  const mix = ctx.createMediaStreamDestination();
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
    echo: new EchoGate(),
    voiced: new Map(),
    dropped: { echo: 0, phantom: 0 },
    stores: new Map([["others", new AudioStore(0)]]),
    mix,
    recorder: null,
    recorded: [],
  };
  kept = null;
  await tap(ctx, tab, "others", true, mix);
  startRecorder(rec);
  if (c.mic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      rec.streams.push(mic);
      // The mic starts a little after the tab: its times count from the recording's start.
      const micOffset = Date.now() - rec.startedAt;
      rec.segmenters.set("you", new Segmenter({ offsetMs: micOffset }));
      rec.stores.set("you", new AudioStore(micOffset));
      await tap(ctx, mic, "you", false, mix);
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
  if (redo && onRedoWorker(m)) return;
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
      let text = cleanTranscript(m.text);
      if (r && job?.speaker === "you") {
        const voiced = r.voiced.get(job.id) ?? Infinity;
        r.voiced.delete(job.id);
        if (text && isMicPhantom(text, voiced)) {
          r.dropped.phantom++;
          void emit({ type: "log", message: `mic "${text}" with ${voiced}ms of voice: phantom, skipped` });
          text = "";
        }
      }
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
  await stopRecorder(r);
  for (const [speaker, seg] of r.segmenters) for (const chunk of seg.flush()) enqueue(chunk, speaker);
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
  kept = { startedAt: r.startedAt, stores: r.stores };
  finishing = false;
  void emit({ type: "drained", durationMs: Date.now() - r.startedAt });
}

// ── the transcript redone after the call (lib/improve.ts) ──────────────────

/** The best model: the only one with sentence times, and the one worth the second pass. */
const REDO_TIER: TierId = "best";
let redo: {
  ready: { resolve: () => void; reject: (e: Error) => void } | null;
  jobs: Map<number, { resolve: (m: Extract<FromWorker, { type: "text" }>) => void; reject: (e: Error) => void }>;
} | null = null;
let redoNext = 1_000_000_000;

/** Worker messages for the redo; false when they are the live recording's. */
function onRedoWorker(m: FromWorker): boolean {
  const d = redo!;
  switch (m.type) {
    case "progress":
      if (!d.ready || m.tier !== REDO_TIER) return false;
      void emit({ type: "improveProgress", step: "download", fraction: m.fraction });
      return true;
    case "ready":
      if (!d.ready || m.tier !== REDO_TIER) return false;
      d.ready.resolve();
      d.ready = null;
      return true;
    case "loadError":
      if (!d.ready || m.tier !== REDO_TIER) return false;
      d.ready.reject(new Error(m.error));
      d.ready = null;
      return true;
    case "text":
    case "transcribeError": {
      const job = d.jobs.get(m.id);
      if (!job) return false;
      d.jobs.delete(m.id);
      if (m.type === "text") job.resolve(m);
      else job.reject(new Error(m.error));
      return true;
    }
  }
}

async function improve(language: string): Promise<void> {
  const k = kept;
  if (!k) throw new Error("nothing was recorded");
  for (const store of k.stores.values()) if (store.full) throw new Error("the recording is longer than Sylence keeps for a second pass");
  redo = { ready: null, jobs: new Map() };
  try {
    await new Promise<void>((resolve, reject) => {
      redo!.ready = { resolve, reject };
      toWorker({ type: "load", tier: REDO_TIER });
    });
    const call = k.stores.get("others");
    const echo = call && k.stores.has("you") ? echoOf(call) : null;
    const windows = [...k.stores].flatMap(([speaker, store]) => windowsOf(store, speaker, speaker === "you" ? echo : null));
    const total = windows.reduce((n, w) => n + (w.endMs - w.startMs), 0) || 1;
    let done = 0;
    const lines: RedoneLine[] = [];
    void emit({ type: "improveProgress", step: "transcribe", fraction: 0 });
    for (const w of windows) {
      const id = redoNext++;
      const copy = w.audio.slice();
      const answer = await new Promise<Extract<FromWorker, { type: "text" }>>((resolve, reject) => {
        redo!.jobs.set(id, { resolve, reject });
        toWorker({ type: "transcribe", id, audio: copy, language, timestamps: true }, [copy.buffer]);
      });
      lines.push(...linesOf(w, answer.chunks, answer.text));
      done += w.endMs - w.startMs;
      void emit({ type: "improveProgress", step: "transcribe", fraction: done / total });
    }
    void emit({ type: "improved", startedAt: k.startedAt, lines: inOrder(lines) });
  } finally {
    redo = null;
  }
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
    case "improve":
      void improve(m.language).catch((e: unknown) => emit({ type: "improveError", error: e instanceof Error ? e.message : String(e) }));
      respond(true);
      return false;
  }
});

