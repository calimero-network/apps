/**
 * An uploaded recording to timed sentences and voices, in the browser with
 * transformers.js. The model files come from Hugging Face once and stay in
 * the browser's cache; the ONNX runtime is bundled with the page. The audio
 * never leaves this worker.
 *
 * 1. Whisper (large-v3 turbo on WebGPU where the page found the device can
 *    hold it, else base on the processor) over
 *    ~30 s windows cut at quiet moments, with sentence timestamps.
 * 2. pyannote segmentation over 10 s windows finds up to three voices in
 *    each; a WeSpeaker voice embedding of each window's voice, clustered
 *    across windows, says which are the same person.
 */
import {
  AutoModel,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type Tensor,
} from "@huggingface/transformers";
import ortMjs from "/ort-dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "/ort-dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import { TIERS, whisperLanguage } from "../../../extension/src/lib/tiers";
import { clusterVoices, cutPoints, RATE, type TimedChunk, type Turn } from "../lib/upload";
import type { FromSpeech, SpeechStage, ToSpeech } from "./speechProtocol";
import { pinnedFetch, revisionOf } from "./models";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
// Every Hugging Face request, the library's own config probes included, reads the pinned commit.
env.fetch = pinnedFetch(self.fetch.bind(self));
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(ortMjs, self.location.href).href,
    wasm: new URL(ortWasm, self.location.href).href,
  };
}

const SEGMENTATION = "onnx-community/pyannote-segmentation-3.0";
const EMBEDDING = "onnx-community/wespeaker-voxceleb-resnet34-LM";
/** pyannote's window. */
const DIARIZE_S = 10;
/** Speech of one voice in a window shorter than this is not embedded. */
const MIN_VOICE_S = 0.8;
/** At most this much of one voice in a window goes into its embedding. */
const MAX_VOICE_S = 6;

const post = (m: FromSpeech) => (self as unknown as Worker).postMessage(m);
const progress = (stage: SpeechStage, fraction: number, bytes?: { loaded: number; total: number }) =>
  post({ type: "progress", stage, fraction: Math.min(1, Math.max(0, fraction)), ...(bytes ? { bytes } : {}) });

/** Download progress over every file of a stage's models, as one fraction and in bytes. */
function downloads(stage: "load" | "voices") {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; name?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file || !p.total) return;
    files.set(`${p.name ?? ""}/${p.file}`, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    progress(stage, total ? loaded / total : 0, { loaded, total });
  };
}

async function loadAsr(tier: "best" | "balanced", onProgress: ReturnType<typeof downloads>) {
  // The page chose the model for this device (lib/device.ts); turbo falls back to base if it cannot load.
  const order = tier === "best" ? (["best", "balanced"] as const) : (["balanced"] as const);
  let last: unknown;
  for (const id of order) {
    const t = TIERS[id];
    try {
      const asr = (await pipeline("automatic-speech-recognition", t.repo, {
        device: t.device,
        dtype: t.dtype as never,
        revision: revisionOf(t.repo),
        progress_callback: onProgress,
      })) as AutomaticSpeechRecognitionPipeline;
      post({ type: "model", modelId: t.modelId, name: t.name });
      return asr;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

type AsrChunk = { timestamp: [number, number | null]; text: string };

async function transcribe(asr: AutomaticSpeechRecognitionPipeline, audio: Float32Array, language: string): Promise<TimedChunk[]> {
  const lang = whisperLanguage(language);
  const windows = cutPoints(audio);
  const out: TimedChunk[] = [];
  for (let w = 0; w < windows.length; w++) {
    const [a, b] = windows[w]!;
    const offset = a / RATE;
    const span = (b - a) / RATE;
    const res = (await asr(audio.subarray(a, b), {
      task: "transcribe",
      return_timestamps: true,
      ...(lang ? { language: lang } : {}),
    } as never)) as unknown as { text: string; chunks?: AsrChunk[] };
    const chunks = res.chunks?.length ? res.chunks : [{ timestamp: [0, span] as [number, number], text: res.text }];
    for (const c of chunks) {
      const text = c.text.trim();
      if (!text) continue;
      const start = Math.min(span, Math.max(0, c.timestamp[0] ?? 0));
      const end = Math.min(span, Math.max(start, c.timestamp[1] ?? span));
      out.push({ start: offset + start, end: offset + end, text });
    }
    progress("transcribe", (w + 1) / windows.length);
  }
  return out;
}

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
  post_process_speaker_diarization(logits: Tensor, samples: number): { id: number; start: number; end: number; confidence: number }[][];
};

async function diarize(audio: Float32Array, onProgress: ReturnType<typeof downloads>): Promise<Turn[]> {
  const [segProc, segModel, embProc, embModel] = await Promise.all([
    AutoProcessor.from_pretrained(SEGMENTATION, { revision: revisionOf(SEGMENTATION), progress_callback: onProgress }) as Promise<Processor>,
    AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION, { dtype: "q8" as never, revision: revisionOf(SEGMENTATION), progress_callback: onProgress }),
    AutoProcessor.from_pretrained(EMBEDDING, { revision: revisionOf(EMBEDDING), progress_callback: onProgress }),
    AutoModel.from_pretrained(EMBEDDING, { dtype: "q8" as never, revision: revisionOf(EMBEDDING), progress_callback: onProgress }),
  ]);
  progress("diarize", 0);
  const win = DIARIZE_S * RATE;
  const windows = Math.max(1, Math.ceil(audio.length / win));
  /** One voice in one window: its turns, and its embedding. */
  const voices: { turns: { start: number; end: number }[]; speech: number; vector: Float32Array | null }[] = [];
  for (let w = 0; w < windows; w++) {
    const a = w * win;
    const slice = audio.subarray(a, Math.min(audio.length, a + win));
    if (slice.length < RATE / 2) continue;
    const inputs = await segProc(slice);
    const { logits } = (await segModel(inputs)) as { logits: Tensor };
    const segments = segProc.post_process_speaker_diarization(logits, slice.length)[0] ?? [];
    // Classes: 0 nobody, 1–3 one of three voices, 4–6 two at once (skipped).
    const local = new Map<number, { start: number; end: number }[]>();
    for (const s of segments) {
      if (s.id < 1 || s.id > 3) continue;
      const list = local.get(s.id) ?? [];
      list.push({ start: a / RATE + s.start, end: a / RATE + s.end });
      local.set(s.id, list);
    }
    for (const turns of local.values()) {
      const speech = turns.reduce((n, t) => n + (t.end - t.start), 0);
      let vector: Float32Array | null = null;
      if (speech >= MIN_VOICE_S) {
        const parts: Float32Array[] = [];
        let left = MAX_VOICE_S * RATE;
        for (const t of [...turns].sort((x, y) => y.end - y.start - (x.end - x.start))) {
          if (left <= 0) break;
          const s0 = Math.round(t.start * RATE);
          const s1 = Math.min(Math.round(t.end * RATE), s0 + left);
          parts.push(audio.subarray(s0, s1));
          left -= s1 - s0;
        }
        const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
          joined.set(p, at);
          at += p.length;
        }
        const out = (await embModel(await embProc(joined))) as Record<string, Tensor>;
        const tensor = out.embeddings ?? Object.values(out)[0];
        if (tensor) vector = Float32Array.from(tensor.data as Float32Array);
      }
      voices.push({ turns, speech, vector });
    }
    progress("diarize", (w + 1) / windows);
  }
  const embedded = voices.filter((v) => v.vector);
  if (embedded.length === 0) return [];
  const groups = clusterVoices(
    embedded.map((v) => v.vector!),
    embedded.map((v) => v.speech),
  );
  const turns: Turn[] = [];
  embedded.forEach((v, i) => v.turns.forEach((t) => turns.push({ ...t, id: groups[i]! })));
  return turns.sort((x, y) => x.start - y.start);
}

self.onmessage = async (e: MessageEvent<ToSpeech>) => {
  const m = e.data;
  if (m.type === "voices") {
    // A recording whose lines are saved already: only who spoke when.
    try {
      progress("voices", 0);
      const turns = await diarize(m.audio, downloads("voices"));
      post({ type: "done", chunks: [], turns });
    } catch (err) {
      post({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (m.type !== "run") return;
  try {
    const onProgress = downloads("load");
    progress("load", 0);
    const asr = await loadAsr(m.tier, onProgress);
    const chunks = await transcribe(asr, m.audio, m.language);
    await asr.dispose();
    progress("voices", 0);
    let turns: Turn[] = [];
    try {
      turns = await diarize(m.audio, downloads("voices"));
    } catch {
      // Without voices the lines are still saved, all as one speaker.
      turns = [];
    }
    post({ type: "done", chunks, turns });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
