/**
 * People insights on this device, with transformers.js: the GoEmotions model
 * scores each transcript line, and (on WebGPU) a Smart notes model writes
 * profiles. The weights come from Hugging Face once and stay in the browser's
 * cache; the ONNX runtime is bundled with the page. Text never leaves here.
 */
import { env, pipeline, type TextClassificationPipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import ortMjs from "@ort/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "@ort/ort-wasm-simd-threaded.asyncify.wasm?url";
import { EMOTION_MODEL, WRITERS, type FromInsightsWorker, type ToInsightsWorker, type WriterId } from "./insightsProtocol";
import { revisionOf } from "./models";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
}

const post = (m: FromInsightsWorker) => (self as unknown as Worker).postMessage(m);

/** Lines per model call. */
const BATCH = 16;
/** Characters of a line the classifier reads (it takes 512 tokens at most). */
const MAX_CHARS = 1_200;

let classifier: Promise<TextClassificationPipeline> | null = null;
let writer: { model: WriterId; gen: Promise<TextGenerationPipeline> } | null = null;

function progressOf(step: "model" | "writer") {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "progress", step, fraction: total ? loaded / total : 0 });
  };
}

function loadClassifier(): Promise<TextClassificationPipeline> {
  classifier ??= pipeline("text-classification", EMOTION_MODEL.repo, {
    device: "wasm",
    dtype: EMOTION_MODEL.dtype as never,
    revision: revisionOf(EMOTION_MODEL.repo),
    progress_callback: progressOf("model"),
  }) as Promise<TextClassificationPipeline>;
  classifier.catch(() => {
    classifier = null;
  });
  return classifier;
}

async function classify(id: number, texts: string[]): Promise<void> {
  try {
    const clf = await loadClassifier();
    const out: Record<string, number>[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS) || ".");
      const res = (await clf(batch, { top_k: null } as never)) as unknown;
      // One input answers one list; several answer a list per input.
      const lists = (batch.length === 1 && !Array.isArray((res as unknown[])[0]) ? [res] : res) as { label: string; score: number }[][];
      for (const list of lists) {
        const scores: Record<string, number> = {};
        for (const { label, score } of list) scores[label] = score;
        out.push(scores);
      }
      post({ type: "progress", step: "classify", fraction: Math.min(1, (i + batch.length) / texts.length) });
    }
    post({ type: "scores", id, scores: out });
  } catch (e) {
    post({ type: "error", id, error: e instanceof Error ? e.message : String(e) });
  }
}

function loadWriter(model: WriterId): Promise<TextGenerationPipeline> {
  if (writer?.model === model) return writer.gen;
  const m = WRITERS[model];
  const previous = writer?.gen;
  const gen = (async () => {
    await (await previous?.catch(() => null))?.dispose();
    return (await pipeline("text-generation", m.repo, {
      device: "webgpu",
      dtype: m.dtype as never,
      revision: revisionOf(m.repo),
      progress_callback: progressOf("writer"),
    })) as TextGenerationPipeline;
  })();
  writer = { model, gen };
  gen.then(
    () => post({ type: "writerReady", model }),
    (e: unknown) => {
      if (writer?.gen === gen) writer = null;
      post({ type: "error", error: e instanceof Error ? e.message : String(e) });
    },
  );
  return gen;
}

async function generate(id: number, messages: { role: string; content: string }[]): Promise<void> {
  if (!writer) {
    post({ type: "error", id, error: "no writing model loaded" });
    return;
  }
  try {
    const gen = await writer.gen;
    const out = (await gen(messages as never, { max_new_tokens: 320, do_sample: false, repetition_penalty: 1.1 } as never)) as {
      generated_text: string | { role: string; content: string }[];
    }[];
    const g = out[0]?.generated_text;
    post({ type: "text", id, text: Array.isArray(g) ? (g.at(-1)?.content ?? "") : (g ?? "") });
  } catch (e) {
    post({ type: "error", id, error: e instanceof Error ? e.message : String(e) });
  }
}

self.addEventListener("message", (event: MessageEvent<ToInsightsWorker>) => {
  const m = event.data;
  if (m.type === "classify") void classify(m.id, m.texts);
  else if (m.type === "loadWriter") void loadWriter(m.model).catch(() => undefined);
  else void generate(m.id, m.messages);
});
