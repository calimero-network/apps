/**
 * The speech worker with transformers.js replaced: loading (once per model,
 * even when asked twice), progress, transcribing after a load, errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "./protocol";

const pipelineCalls: { repo: string; device: string }[] = [];
const disposed: string[] = [];
let loadGate: (() => void) | null = null;
let failLoad: string | null = null;

vi.mock("@ort/ort-wasm-simd-threaded.asyncify.mjs?url", () => ({ default: "ort.mjs" }));
vi.mock("@ort/ort-wasm-simd-threaded.asyncify.wasm?url", () => ({ default: "ort.wasm" }));
vi.mock("@huggingface/transformers", () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: async (
    _task: string,
    repo: string,
    opts: { device: string; progress_callback: (p: unknown) => void },
  ) => {
    pipelineCalls.push({ repo, device: opts.device });
    opts.progress_callback({ status: "progress", file: "encoder.onnx", loaded: 50, total: 100 });
    if (loadGate) await new Promise<void>((r) => (loadGate = r));
    if (failLoad) throw new Error(failLoad);
    const asr = async (audio: Float32Array, options: Record<string, unknown>) => {
      if (audio.length === 0) throw new Error("empty audio");
      return { text: `${repo} heard ${audio.length} samples${options.language ? ` in ${options.language}` : ""}` };
    };
    asr.dispose = async () => {
      disposed.push(repo);
    };
    return asr;
  },
}));

let posted: FromWorker[] = [];
let listener: ((e: MessageEvent<ToWorker>) => void) | null = null;

async function boot(): Promise<void> {
  vi.resetModules();
  posted = [];
  pipelineCalls.length = 0;
  disposed.length = 0;
  loadGate = null;
  failLoad = null;
  vi.spyOn(window, "postMessage").mockImplementation(((m: FromWorker) => {
    posted.push(m);
  }) as typeof window.postMessage);
  // Each fresh import adds its own listener; keep only this one's.
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, l: EventListener, o?: unknown) => {
    if (type === "message") listener = l as unknown as typeof listener;
    else add(type, l, o as AddEventListenerOptions);
  }) as typeof window.addEventListener);
  await import("./worker");
}

function send(m: ToWorker): void {
  listener!(new MessageEvent("message", { data: m }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const of = <T extends FromWorker["type"]>(type: T) => posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);

beforeEach(boot);
afterEach(() => vi.restoreAllMocks());

describe("speech worker", () => {
  it("loads a model, reports progress, then transcribes", async () => {
    send({ type: "load", tier: "light" });
    await settle();
    expect(of("progress")[0]).toMatchObject({ tier: "light", fraction: 0.5 });
    expect(of("ready")).toEqual([expect.objectContaining({ tier: "light" })]);
    send({ type: "transcribe", id: 1, audio: new Float32Array(16_000), language: "en" });
    await settle();
    const [text] = of("text");
    expect(text).toMatchObject({ id: 1 });
    expect(text!.text).toContain("heard 16000 samples");
    expect(text!.ms).toBeGreaterThanOrEqual(0);
  });

  it("loads a model once when asked twice before it is ready (preload, then record)", async () => {
    loadGate = () => undefined;
    send({ type: "load", tier: "light" });
    send({ type: "load", tier: "light" });
    await settle();
    loadGate();
    await settle();
    expect(pipelineCalls).toHaveLength(1);
    expect(of("ready").length).toBeGreaterThanOrEqual(1);
    expect(of("ready").every((r) => r.tier === "light")).toBe(true);
  });

  it("answers ready at once for the model already loaded", async () => {
    send({ type: "load", tier: "light" });
    await settle();
    send({ type: "load", tier: "light" });
    await settle();
    expect(pipelineCalls).toHaveLength(1);
    expect(of("ready")).toHaveLength(2);
  });

  it("loads models one after the other and frees the first", async () => {
    loadGate = () => undefined;
    send({ type: "load", tier: "light" });
    send({ type: "load", tier: "ultralight" });
    await settle();
    // The second waits for the first.
    expect(pipelineCalls).toHaveLength(1);
    loadGate();
    await settle();
    loadGate?.();
    await settle();
    expect(pipelineCalls).toHaveLength(2);
    expect(disposed).toEqual([pipelineCalls[0]!.repo]);
    expect(of("ready").map((r) => r.tier)).toEqual(["light", "ultralight"]);
  });

  it("transcribes speech that arrives while the model loads, once it is ready", async () => {
    loadGate = () => undefined;
    send({ type: "load", tier: "ultralight" });
    await settle();
    send({ type: "transcribe", id: 7, audio: new Float32Array(8_000), language: "en" });
    await settle();
    expect(of("text")).toHaveLength(0);
    loadGate();
    await settle();
    expect(of("text")[0]).toMatchObject({ id: 7 });
  });

  it("frees the previous model when switching", async () => {
    send({ type: "load", tier: "light" });
    await settle();
    send({ type: "load", tier: "ultralight" });
    await settle();
    expect(disposed).toHaveLength(1);
    expect(pipelineCalls).toHaveLength(2);
    send({ type: "transcribe", id: 2, audio: new Float32Array(10), language: "" });
    await settle();
    expect(of("text")[0]!.text).toContain(pipelineCalls[1]!.repo);
  });

  it("passes the language to Whisper only", async () => {
    send({ type: "load", tier: "balanced" });
    await settle();
    send({ type: "transcribe", id: 3, audio: new Float32Array(10), language: "de" });
    await settle();
    expect(of("text")[0]!.text).toMatch(/in (german|de)/);
    vi.restoreAllMocks();
    await boot();
    send({ type: "load", tier: "ultralight" });
    await settle();
    send({ type: "transcribe", id: 4, audio: new Float32Array(10), language: "de" });
    await settle();
    expect(of("text")[0]!.text).not.toContain(" in ");
  });

  it("reports a model that can't load, and transcribing without one", async () => {
    failLoad = "WebGPU is not available";
    send({ type: "load", tier: "best" });
    await settle();
    expect(of("loadError")).toEqual([{ type: "loadError", tier: "best", error: "WebGPU is not available" }]);
    send({ type: "transcribe", id: 5, audio: new Float32Array(10), language: "en" });
    await settle();
    expect(of("transcribeError")).toEqual([{ type: "transcribeError", id: 5, error: "no model loaded" }]);
  });

  it("reports a failed transcription and keeps going", async () => {
    send({ type: "load", tier: "light" });
    await settle();
    send({ type: "transcribe", id: 8, audio: new Float32Array(0), language: "en" });
    send({ type: "transcribe", id: 9, audio: new Float32Array(100), language: "en" });
    await settle();
    expect(of("transcribeError")).toEqual([{ type: "transcribeError", id: 8, error: "empty audio" }]);
    expect(of("text").map((t) => t.id)).toEqual([9]);
  });
});
