/**
 * The offscreen page's pipeline with fake audio and a fake speech worker:
 * audio in → stretches of speech → the worker → segments out, with their
 * times; stop drains what is left; the model steps down safely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OffscreenCommand, OffscreenEvent } from "../lib/messages";
import type { FromWorker, ToWorker } from "../transcribe/protocol";

vi.mock("../audio/tap.worklet.ts?worker&url", () => ({ default: "tap.worklet.js" }));
vi.mock("../lib/caps", () => ({
  detectCaps: async () => ({ webgpu: false, maxBufferSize: 0, cached: [], deviceMemoryGb: 8, cores: 8 }),
}));

const RATE = 16_000;

function tone(ms: number, amp = 0.2, freq = 220): Float32Array {
  const n = Math.round((RATE * ms) / 1000);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE));
}
const silence = (ms: number) => new Float32Array(Math.round((RATE * ms) / 1000));

// ── fakes ────────────────────────────────────────────────────────────────────

class FakeWorker {
  static all: FakeWorker[] = [];
  posted: ToWorker[] = [];
  private listener: ((e: { data: FromWorker }) => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: ToWorker) {
    this.posted.push(m);
  }
  addEventListener(_type: string, l: (e: { data: FromWorker }) => void) {
    this.listener = l;
  }
  reply(m: FromWorker) {
    this.listener!({ data: m });
  }
  get transcribes() {
    return this.posted.filter((m): m is Extract<ToWorker, { type: "transcribe" }> => m.type === "transcribe");
  }
  get loads() {
    return this.posted.filter((m) => m.type === "load").map((m) => (m as { tier: string }).tier);
  }
}

class FakeWorkletNode {
  static all: FakeWorkletNode[] = [];
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor() {
    FakeWorkletNode.all.push(this);
  }
  connect<T>(next: T): T {
    return next;
  }
  /** Feeds audio in worklet-sized blocks. */
  feed(audio: Float32Array, block = 1_600) {
    for (let i = 0; i < audio.length; i += block) this.port.onmessage!({ data: audio.slice(i, i + block) });
  }
}

class FakeAudioContext {
  static closed = 0;
  sampleRate = RATE;
  destination = {};
  audioWorklet = { addModule: async () => undefined };
  createMediaStreamSource() {
    return { connect: <T>(n: T) => n };
  }
  createGain() {
    return { gain: { value: 1 }, connect: <T>(n: T) => n };
  }
  async close() {
    FakeAudioContext.closed += 1;
  }
}

interface Harness {
  events: OffscreenEvent[];
  stoppedTracks: number;
  micDenied: boolean;
  tabDenied: boolean;
  listener: (m: unknown, s: unknown, respond: (r: unknown) => void) => boolean | void;
}

let h: Harness;

async function boot(): Promise<void> {
  vi.resetModules();
  FakeWorker.all = [];
  FakeWorkletNode.all = [];
  FakeAudioContext.closed = 0;
  h = { events: [], stoppedTracks: 0, micDenied: false, tabDenied: false, listener: () => undefined };
  const stream = () => ({ getTracks: () => [{ stop: () => (h.stoppedTracks += 1) }] });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (c: { audio: unknown }) => {
        const isTab = JSON.stringify(c.audio).includes("chromeMediaSource");
        if (isTab && h.tabDenied) throw new Error("Error starting tab capture");
        if (!isTab && h.micDenied) throw new DOMException("Permission denied", "NotAllowedError");
        return stream();
      },
    },
  });
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: async (e: OffscreenEvent) => {
        h.events.push(e);
      },
      onMessage: { addListener: (l: Harness["listener"]) => (h.listener = l) },
    },
  });
  await import("./index");
}

function command(c: Omit<OffscreenCommand, "target"> & { type: OffscreenCommand["type"] }): Promise<unknown> {
  return new Promise((resolve) => {
    const async = h.listener({ ...c, target: "offscreen" }, {}, resolve);
    if (async !== true) resolve(undefined);
  });
}

const capture = (mic = true, tier = "light") =>
  command({ type: "capture", streamId: "s1", mic, tier, language: "en" } as Omit<OffscreenCommand, "target"> & { type: "capture" });

const worker = () => FakeWorker.all[0]!;
const tabNode = () => FakeWorkletNode.all[0]!;
const micNode = () => FakeWorkletNode.all[1]!;
const ofType = <T extends OffscreenEvent["type"]>(type: T) =>
  h.events.filter((e): e is Extract<OffscreenEvent, { type: T }> => e.type === type);
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** One stretch of speech after the room's quiet, then enough quiet to close it. */
const phrase = (ms = 2_000) => [silence(700), tone(ms), silence(2_500)];

beforeEach(boot);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offscreen pipeline", () => {
  it("turns speech into a segment with its time in the meeting", async () => {
    expect(await capture()).toBe(true);
    expect(worker().loads).toEqual(["light"]);
    expect(ofType("model")[0]).toMatchObject({ tier: "light", state: "loading" });

    for (const part of phrase()) tabNode().feed(part);
    // Nothing goes to the worker before the model is ready.
    expect(worker().transcribes).toHaveLength(0);

    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    expect(ofType("model").at(-1)).toMatchObject({ state: "ready" });
    const [job] = worker().transcribes;
    expect(job).toBeDefined();
    // About 2 s of speech plus a short lead-in, at 16 kHz.
    expect(job!.audio.length).toBeGreaterThan(RATE * 1.9);
    expect(job!.audio.length).toBeLessThan(RATE * 3);
    expect(job!.language).toBe("en");

    worker().reply({ type: "text", id: job!.id, text: " Hello there. ", ms: 300 });
    await flushMicrotasks();
    const [seg] = ofType("segment");
    expect(seg).toMatchObject({ speaker: "others", text: "Hello there." });
    // Speech started at 700 ms; the lead-in starts it a little earlier.
    expect(seg!.startMs).toBeGreaterThanOrEqual(400);
    expect(seg!.startMs).toBeLessThanOrEqual(700);
    expect(seg!.endMs).toBeGreaterThan(2_600);
    expect(seg!.endMs).toBeLessThan(3_600);
  });

  it("sends stretches one at a time, oldest first across tab and mic", async () => {
    await capture();
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    // The mic speaks first, the tab answers later.
    micNode().feed(silence(700));
    tabNode().feed(silence(700));
    micNode().feed(tone(1_500));
    tabNode().feed(silence(1_500));
    micNode().feed(silence(2_500));
    tabNode().feed(tone(1_500));
    tabNode().feed(silence(2_500));
    expect(worker().transcribes).toHaveLength(1);
    const first = worker().transcribes[0]!;
    worker().reply({ type: "text", id: first.id, text: "me first", ms: 200 });
    expect(worker().transcribes).toHaveLength(2);
    const second = worker().transcribes[1]!;
    worker().reply({ type: "text", id: second.id, text: "then them", ms: 200 });
    await flushMicrotasks();
    expect(ofType("segment").map((s) => [s.speaker, s.text])).toEqual([
      ["you", "me first"],
      ["others", "then them"],
    ]);
    const [a, b] = ofType("segment");
    expect(a!.startMs).toBeLessThan(b!.startMs);
  });

  it("drops silence and phantom text, emits nothing for them", async () => {
    await capture(false);
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    tabNode().feed(silence(10_000));
    expect(worker().transcribes).toHaveLength(0);
    for (const part of phrase()) tabNode().feed(part);
    const job = worker().transcribes[0]!;
    worker().reply({ type: "text", id: job.id, text: "[BLANK_AUDIO]", ms: 100 });
    await flushMicrotasks();
    expect(ofType("segment")).toHaveLength(0);
  });

  it("stop flushes the open stretch, transcribes it, then reports drained", async () => {
    await capture(false);
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    tabNode().feed(silence(700));
    tabNode().feed(tone(1_800)); // still talking when Stop is pressed
    expect(worker().transcribes).toHaveLength(0);
    const stopped = command({ type: "stop" });
    await stopped;
    expect(h.stoppedTracks).toBe(1);
    const job = worker().transcribes[0]!;
    expect(job).toBeDefined();
    expect(ofType("drained")).toHaveLength(0);
    // Audio arriving after Stop is ignored.
    tabNode().feed(tone(3_000));
    tabNode().feed(silence(2_000));
    worker().reply({ type: "text", id: job.id, text: "cut off mid sentence", ms: 200 });
    await flushMicrotasks();
    expect(worker().transcribes).toHaveLength(1);
    const events = h.events.map((e) => e.type).filter((t) => t === "segment" || t === "drained");
    // The segment is sent before drained, so the service worker queues it first.
    expect(events).toEqual(["segment", "drained"]);
    expect(FakeAudioContext.closed).toBe(1);
  });

  it("stop before the model is ready keeps the audio and transcribes it once ready", async () => {
    await capture(false);
    for (const part of phrase()) tabNode().feed(part);
    await command({ type: "stop" });
    expect(ofType("drained")).toHaveLength(0);
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    const job = worker().transcribes[0]!;
    worker().reply({ type: "text", id: job.id, text: "said while loading", ms: 500 });
    await flushMicrotasks();
    expect(ofType("segment").map((s) => s.text)).toEqual(["said while loading"]);
    expect(ofType("drained")).toHaveLength(1);
  });

  it("stop with nothing captured drains at once", async () => {
    await capture(false);
    await command({ type: "stop" });
    await flushMicrotasks();
    expect(ofType("drained")).toHaveLength(1);
  });

  it("stop with no recording still answers drained", async () => {
    await command({ type: "stop" });
    await flushMicrotasks();
    expect(ofType("drained")).toEqual([expect.objectContaining({ durationMs: 0 })]);
  });

  it("a failed transcription is logged and the next stretch still goes", async () => {
    await capture(false);
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    for (const part of [...phrase(), tone(2_000), silence(2_500)]) tabNode().feed(part);
    const first = worker().transcribes[0]!;
    worker().reply({ type: "transcribeError", id: first.id, error: "out of memory" });
    await flushMicrotasks();
    expect(ofType("log")[0]!.message).toContain("out of memory");
    const second = worker().transcribes[1]!;
    worker().reply({ type: "text", id: second.id, text: "recovered", ms: 200 });
    await flushMicrotasks();
    expect(ofType("segment").map((s) => s.text)).toEqual(["recovered"]);
  });

  it("falls to a lighter model when one can't load, and gives up after the lightest", async () => {
    await capture(false, "light");
    worker().reply({ type: "loadError", tier: "light", error: "WebGPU unavailable" });
    expect(worker().loads).toEqual(["light", "ultralight"]);
    expect(ofType("stepDown")[0]).toMatchObject({ from: "light", to: "ultralight" });
    worker().reply({ type: "loadError", tier: "ultralight", error: "no wasm" });
    expect(ofType("model").at(-1)).toMatchObject({ state: "error" });
  });

  it("a model that can't load while stopping still ends the recording", async () => {
    await capture(false, "ultralight");
    for (const part of phrase()) tabNode().feed(part);
    await command({ type: "stop" });
    worker().reply({ type: "loadError", tier: "ultralight", error: "no wasm" });
    await flushMicrotasks();
    expect(ofType("drained")).toHaveLength(1);
  });

  it("does not replace the model while it is transcribing", async () => {
    await capture(false, "light");
    worker().reply({ type: "ready", tier: "light", device: "wasm" });
    tabNode().feed(silence(700));
    // Three answers at half real time: fast enough.
    for (let i = 0; i < 3; i++) {
      for (const part of [tone(2_000), silence(2_500)]) tabNode().feed(part);
      const job = worker().transcribes[i]!;
      worker().reply({ type: "text", id: job.id, text: `ok ${i}`, ms: 1_000 });
    }
    // The fourth stretch is with the model while a minute of speech piles up.
    for (const part of [tone(2_000), silence(2_500)]) tabNode().feed(part);
    const busy = worker().transcribes[3]!;
    for (let i = 0; i < 20; i++) for (const part of [tone(3_000), silence(2_500)]) tabNode().feed(part);
    // Swapping now would dispose the pipeline under the running stretch.
    expect(worker().loads).toEqual(["light"]);
    worker().reply({ type: "text", id: busy.id, text: "finished before the swap", ms: 1_000 });
    await flushMicrotasks();
    expect(ofType("segment").at(-1)!.text).toBe("finished before the swap");
    // Then it steps down, and the backlog goes to the lighter model once it is ready.
    expect(worker().loads).toEqual(["light", "ultralight"]);
    expect(ofType("stepDown").at(-1)).toMatchObject({ from: "light", to: "ultralight" });
    const sent = worker().transcribes.length;
    worker().reply({ type: "ready", tier: "ultralight", device: "wasm" });
    expect(worker().transcribes.length).toBe(sent + 1);
  });

  it("records the tab alone when the mic is refused, and says so", async () => {
    h.micDenied = true;
    expect(await capture(true)).toBe(true);
    await flushMicrotasks();
    expect(ofType("notice")[0]!.message).toMatch(/microphone/i);
    expect(FakeWorkletNode.all).toHaveLength(1);
  });

  it("reports a tab that can't be captured", async () => {
    h.tabDenied = true;
    expect(await capture()).toBe(false);
    await flushMicrotasks();
    expect(ofType("captureError")[0]!.message).toBe("Could not record the tab: Error starting tab capture");
    expect(worker()).toBeUndefined();
  });

  it("answers caps and preloads a model on request", async () => {
    const caps = await command({ type: "caps" });
    expect(caps).toMatchObject({ cores: 8 });
    await command({ type: "preload", tier: "balanced" } as Omit<OffscreenCommand, "target"> & { type: "preload" });
    expect(worker().loads).toEqual(["balanced"]);
  });

  it("sends levels and ticks while recording, and stops them when drained", async () => {
    vi.useFakeTimers();
    try {
      await capture(false);
      tabNode().feed(tone(500));
      vi.advanceTimersByTime(4_100);
      expect(ofType("levels").length).toBeGreaterThan(10);
      expect(ofType("levels").some((l) => l.others > 0.05)).toBe(true);
      expect(ofType("tick")).toHaveLength(1);
      await command({ type: "stop" });
      await flushMicrotasks();
      const before = h.events.length;
      vi.advanceTimersByTime(10_000);
      expect(h.events.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
