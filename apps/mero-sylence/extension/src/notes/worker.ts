/**
 * The notes model: Qwen2.5 Instruct through transformers.js on WebGPU, in its
 * own worker so it never slows the speech worker. The weights come from
 * Hugging Face once and stay in the browser's cache; the ONNX runtime is the
 * one bundled with the extension.
 */
import { env, pipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import ortMjs from "@ort/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "@ort/ort-wasm-simd-threaded.asyncify.wasm?url";
import { NOTES_MODELS, MAX_NEW_TOKENS, type NotesModelId } from "../lib/notes";
import { aggregateProgress } from "../lib/text";
import type { FromNotesWorker, ToNotesWorker } from "./protocol";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
}

const post = (m: FromNotesWorker) => (self as unknown as Worker).postMessage(m);

let loaded: { model: NotesModelId; gen: TextGenerationPipeline } | null = null;
let loading: Promise<void> | null = null;
let loadingModel: NotesModelId | null = null;

async function load(model: NotesModelId, device: "webgpu" | "wasm"): Promise<void> {
  if (loaded?.model === model) {
    post({ type: "ready", model });
    return;
  }
  const m = NOTES_MODELS[model];
  const files = new Map<string, { loaded: number; total: number }>();
  try {
    const previous = loaded;
    loaded = null;
    await previous?.gen.dispose();
    const gen = (await pipeline("text-generation", m.repo, {
      device,
      // WebGPU runs the half-precision 4-bit weights; the CPU fallback (tests) the plain 4-bit ones.
      dtype: (device === "webgpu" ? m.dtype : "q4") as never,
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        post({ type: "progress", model, ...aggregateProgress(files) });
      },
    })) as TextGenerationPipeline;
    loaded = { model, gen };
    post({ type: "ready", model });
  } catch (e) {
    post({ type: "loadError", model, error: e instanceof Error ? e.message : String(e) });
  }
}

async function generate(id: number, messages: { role: string; content: string }[]): Promise<void> {
  if (loading) await loading;
  if (!loaded) {
    post({ type: "generateError", id, error: "no notes model loaded" });
    return;
  }
  try {
    const out = (await loaded.gen(messages as never, {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      repetition_penalty: 1.1,
    } as never)) as { generated_text: string | { role: string; content: string }[] }[];
    const g = out[0]?.generated_text;
    const text = Array.isArray(g) ? (g.at(-1)?.content ?? "") : (g ?? "");
    post({ type: "text", id, text });
  } catch (e) {
    post({ type: "generateError", id, error: e instanceof Error ? e.message : String(e) });
  }
}

self.addEventListener("message", (event: MessageEvent<ToNotesWorker>) => {
  const m = event.data;
  if (m.type === "load") {
    if (loading && loadingModel === m.model) return;
    loadingModel = m.model;
    const previous = loading ?? Promise.resolve();
    const next = previous.then(() => load(m.model, m.device ?? "webgpu"));
    loading = next;
    void next.finally(() => {
      if (loading === next) {
        loading = null;
        loadingModel = null;
      }
    });
    return;
  }
  void generate(m.id, m.messages);
});
