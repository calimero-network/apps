/**
 * Speech to text on this device, with transformers.js. The model files come
 * from Hugging Face once and stay in the browser's cache; the ONNX runtime is
 * bundled with the extension (no remote code). Audio never leaves here.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import ortMjs from "@ort/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "@ort/ort-wasm-simd-threaded.asyncify.wasm?url";
import { aggregateProgress } from "../lib/text";
import { TIERS, whisperLanguage, type TierId } from "../lib/tiers";
import type { FromWorker, ToWorker } from "./protocol";

env.allowLocalModels = false;
env.useBrowserCache = true;
// The runtime is loaded from the extension itself; a blob: copy would break the extension's CSP.
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
}

let loaded: { tier: TierId; asr: AutomaticSpeechRecognitionPipeline } | null = null;
/** Loads run one after the other; `loadingTier` is the last one asked for. */
let loading: Promise<void> | null = null;
let loadingTier: TierId | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

async function load(tier: TierId): Promise<void> {
  if (loaded?.tier === tier) {
    post({ type: "ready", tier, device: TIERS[tier].device });
    return;
  }
  const t = TIERS[tier];
  const files = new Map<string, { loaded: number; total: number }>();
  try {
    const previous = loaded;
    loaded = null;
    await previous?.asr.dispose();
    const asr = (await pipeline("automatic-speech-recognition", t.repo, {
      device: t.device,
      dtype: t.dtype as never,
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        post({ type: "progress", tier, ...aggregateProgress(files) });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    loaded = { tier, asr };
    post({ type: "ready", tier, device: t.device });
  } catch (e) {
    post({ type: "loadError", tier, error: e instanceof Error ? e.message : String(e) });
  }
}

async function transcribe(id: number, audio: Float32Array, language: string): Promise<void> {
  if (loading) await loading;
  if (!loaded) {
    post({ type: "transcribeError", id, error: "no model loaded" });
    return;
  }
  const started = performance.now();
  try {
    const isWhisper = loaded.tier === "best" || loaded.tier === "balanced";
    const lang = whisperLanguage(language);
    const out = await loaded.asr(audio, isWhisper ? { task: "transcribe", ...(lang ? { language: lang } : {}) } : {});
    const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
    post({ type: "text", id, text, ms: performance.now() - started });
  } catch (e) {
    post({ type: "transcribeError", id, error: e instanceof Error ? e.message : String(e) });
  }
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  if (m.type === "load") {
    // Asked again for the model already on its way (a preload, then Record):
    // its `ready` answers both. Loading it twice would hold it twice in memory.
    if (loading && loadingTier === m.tier) return;
    const tier = m.tier;
    loadingTier = tier;
    const next: Promise<void> = (loading ?? Promise.resolve()).then(() => load(tier)).finally(() => {
      if (loading === next) {
        loading = null;
        loadingTier = null;
      }
    });
    loading = next;
  } else {
    void transcribe(m.id, m.audio, m.language);
  }
});
