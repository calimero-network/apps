import type { SegmentInput } from "../generated/client";

/**
 * An uploaded recording, from file to transcript lines. The model runs are in
 * `ai/speech.worker.ts`; this file is the model-free half, pinned by
 * `upload.test.ts`: where to cut the audio, which voice said each sentence,
 * how the voices are numbered, and how the lines become `appendSegments`
 * batches.
 */

/** The speech rate every model here takes. */
export const RATE = 16_000;

/** The largest blob a node keeps (47.25 MiB), so the largest recording saved for playback. */
export const MAX_AUDIO_BYTES = 49_545_216;

/** Longer than this is refused before decoding: the decoded audio alone would not fit in a tab. */
export const MAX_DURATION_MS = 4 * 60 * 60_000;

/** What the file picker offers. */
export const ACCEPT = "audio/*,video/mp4,video/webm,.mp3,.m4a,.mp4,.wav,.webm,.ogg,.oga,.opus,.aac,.flac";

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** The file's type as the browser plays it: its own when set, else from the extension. */
export function audioMime(file: { name: string; type: string }): string {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "";
}

/** True when the file looks like something the page can decode. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  return audioMime(file) !== "";
}

/** Why the audio is not kept for playback, or null when it fits. */
export function tooLargeForAudio(bytes: number): string | null {
  if (bytes <= MAX_AUDIO_BYTES) return null;
  const mib = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return `This file is ${mib(bytes)} MiB; a workspace keeps recordings up to ${mib(MAX_AUDIO_BYTES)} MiB. The transcript is saved without the audio.`;
}

/** A meeting title from a file name: no extension, separators as spaces, at most 200 characters. */
export function titleFromFile(name: string): string {
  const base = name.replace(/\.[^./\\]{1,5}$/, "");
  const title = base.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200).trim();
  return title || "Uploaded recording";
}

/** `bytes` as `12.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Cutting the audio ───────────────────────────────────────────────────────

/**
 * Where to cut `samples` samples of audio into windows of about `windowS`
 * seconds: at the quietest 100 ms in the last `searchS` seconds before each
 * window's end, so a word is rarely cut in half. Answers the window bounds
 * in samples, `[0, a], [a, b], …, [z, samples]`.
 */
export function cutPoints(audio: Float32Array, windowS = 30, searchS = 5, rate = RATE): [number, number][] {
  const n = audio.length;
  const win = Math.round(windowS * rate);
  const frame = Math.round(0.1 * rate);
  const out: [number, number][] = [];
  let start = 0;
  while (n - start > win) {
    const hi = start + win;
    const lo = Math.max(start + frame, hi - Math.round(searchS * rate));
    let best = hi;
    let bestEnergy = Infinity;
    for (let f = lo; f + frame <= hi; f += frame) {
      let e = 0;
      for (let i = f; i < f + frame; i++) e += audio[i]! * audio[i]!;
      if (e < bestEnergy) {
        bestEnergy = e;
        best = f + Math.floor(frame / 2);
      }
    }
    out.push([start, best]);
    start = best;
  }
  if (n > start || out.length === 0) out.push([start, n]);
  return out;
}

// ── Who said it ─────────────────────────────────────────────────────────────

/** A sentence from the speech model, seconds from the recording's start. */
export interface TimedChunk {
  start: number;
  end: number;
  text: string;
}

/** A stretch of one voice, seconds from the start; `id` the voice's cluster. */
export interface Turn {
  start: number;
  end: number;
  id: number;
}

export interface SpokenLine {
  startMs: number;
  endMs: number;
  speakerIndex: number;
  text: string;
}

/**
 * Each sentence with the voice that overlaps it most; a sentence no turn
 * overlaps takes the nearest one. Voice -1 when there are no turns at all.
 */
export function assignSpeakers(chunks: readonly TimedChunk[], turns: readonly Turn[]): SpokenLine[] {
  return chunks.map((c) => {
    const end = Math.max(c.end, c.start);
    const overlap = new Map<number, number>();
    for (const t of turns) {
      const o = Math.min(end, t.end) - Math.max(c.start, t.start);
      if (o > 0) overlap.set(t.id, (overlap.get(t.id) ?? 0) + o);
    }
    let id = -1;
    if (overlap.size) {
      let most = -1;
      for (const [k, v] of overlap) if (v > most) [id, most] = [k, v];
    } else if (turns.length) {
      const mid = (c.start + end) / 2;
      let near = Infinity;
      for (const t of turns) {
        const d = mid < t.start ? t.start - mid : mid > t.end ? mid - t.end : 0;
        if (d < near) [id, near] = [t.id, d];
      }
    }
    return { startMs: Math.round(c.start * 1000), endMs: Math.round(end * 1000), speakerIndex: id, text: c.text };
  });
}

/** The voices renumbered by who spoke first: `Speaker 1`, `Speaker 2`, … */
export function labelSpeakers(lines: readonly SpokenLine[]): (SpokenLine & { label: string })[] {
  const order = new Map<number, number>();
  for (const l of lines) if (!order.has(l.speakerIndex)) order.set(l.speakerIndex, order.size + 1);
  return lines.map((l) => ({ ...l, label: `Speaker ${order.get(l.speakerIndex)}` }));
}

// ── Lines to segments ───────────────────────────────────────────────────────

/** The contract's limit on one line. */
export const MAX_LINE_CHARS = 4_000;
/** Lines longer than this are split at sentence ends. */
export const MAX_LINE_MS = 30_000;

/** `text` cut at sentence ends into pieces of at most `parts` roughly equal runs. */
function splitSentences(text: string, parts: number): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  if (parts <= 1 || sentences.length <= 1) return [text];
  const target = text.length / parts;
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    cur = cur ? `${cur} ${s}` : s;
    if (cur.length >= target && out.length < parts - 1) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Labelled lines as `appendSegments` input: numbered from 0, speaker
 * `others`, the label as the name; empty lines skipped, text capped at 4,000
 * characters, and a line over 30 s split at sentence ends with its time
 * shared out by length.
 */
export function toSegmentInputs(lines: readonly (SpokenLine & { label: string })[]): SegmentInput[] {
  const out: SegmentInput[] = [];
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const span = Math.max(0, l.endMs - l.startMs);
    const pieces = span > MAX_LINE_MS ? splitSentences(text, Math.ceil(span / MAX_LINE_MS)) : [text];
    const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
    let at = l.startMs;
    pieces.forEach((p, i) => {
      const end = i === pieces.length - 1 ? l.endMs : at + Math.round((span * p.length) / total);
      out.push({
        seq: out.length,
        startMs: at,
        endMs: Math.max(at, end),
        speaker: "others",
        name: l.label.slice(0, 100),
        text: p.slice(0, MAX_LINE_CHARS),
      });
      at = end;
    });
  }
  return out;
}

/** `items` in runs of at most `size`. */
export function batches<T>(items: readonly T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Telling voices apart ────────────────────────────────────────────────────

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Voice embeddings grouped by speaker: each joins the closest group when it
 * is at least `threshold` alike (cosine), else starts one; then groups that
 * alike are merged, and a group holding under `minShare` of the speech
 * (weights) joins its closest. Answers a group number per embedding,
 * numbered from 0 with no gaps.
 */
export function clusterVoices(
  vectors: readonly ArrayLike<number>[],
  weights: readonly number[] = vectors.map(() => 1),
  threshold = 0.5,
  minShare = 0.03,
): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  type Group = { sum: Float64Array; weight: number; members: number[] };
  const groups: Group[] = [];
  const centroid = (g: Group) => g.sum;
  const add = (g: Group, i: number) => {
    const v = vectors[i]!;
    const w = weights[i] ?? 1;
    for (let d = 0; d < dim; d++) g.sum[d]! += v[d]! * w;
    g.weight += w;
    g.members.push(i);
  };
  vectors.forEach((v, i) => {
    let best = -1;
    let bestSim = threshold;
    groups.forEach((g, k) => {
      const s = cosine(v, centroid(g));
      if (s >= bestSim) [best, bestSim] = [k, s];
    });
    if (best < 0) {
      const g: Group = { sum: new Float64Array(dim), weight: 0, members: [] };
      add(g, i);
      groups.push(g);
    } else add(groups[best]!, i);
  });
  const merge = (into: Group, from: Group) => {
    for (let d = 0; d < dim; d++) into.sum[d]! += from.sum[d]!;
    into.weight += from.weight;
    into.members.push(...from.members);
  };
  const closest = (k: number, min: number): number => {
    let best = -1;
    let bestSim = min;
    groups.forEach((g, j) => {
      if (j === k) return;
      const s = cosine(centroid(groups[k]!), centroid(g));
      if (s >= bestSim) [best, bestSim] = [j, s];
    });
    return best;
  };
  // Merge alike groups, most alike first.
  for (;;) {
    let pair: [number, number] | null = null;
    let top = threshold;
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        const s = cosine(centroid(groups[a]!), centroid(groups[b]!));
        if (s >= top) [pair, top] = [[a, b], s];
      }
    if (!pair) break;
    merge(groups[pair[0]]!, groups[pair[1]]!);
    groups.splice(pair[1], 1);
  }
  // Fold in groups too small to be a person.
  const total = groups.reduce((n, g) => n + g.weight, 0);
  for (;;) {
    if (groups.length < 2) break;
    let smallest = -1;
    groups.forEach((g, k) => {
      if (g.weight < total * minShare && (smallest < 0 || g.weight < groups[smallest]!.weight)) smallest = k;
    });
    if (smallest < 0) break;
    const into = closest(smallest, -Infinity);
    merge(groups[into]!, groups[smallest]!);
    groups.splice(smallest, 1);
  }
  const out = new Array<number>(vectors.length).fill(0);
  groups.forEach((g, k) => g.members.forEach((i) => (out[i] = k)));
  return out;
}

// ── Decoding ────────────────────────────────────────────────────────────────

/** The file decoded to 16 kHz mono, as the speech models take it. Browser only. */
export async function decodeTo16kMono(file: Blob): Promise<{ audio: Float32Array; durationMs: number }> {
  const bytes = await file.arrayBuffer();
  // decodeAudioData resamples to the context's rate.
  const ctx = new OfflineAudioContext(1, 1, RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error("This browser cannot decode that file. Try an mp3, m4a, wav or webm recording.");
  }
  const n = decoded.length;
  const audio = new Float32Array(n);
  const channels = decoded.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) audio[i]! += data[i]! / channels;
  }
  return { audio, durationMs: Math.round((n / RATE) * 1000) };
}
