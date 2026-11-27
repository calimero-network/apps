/**
 * The transcript redone after the call. While recording, each source's audio
 * is kept here (16 kHz, 16-bit, in memory, never uploaded). After Stop the
 * best speech model goes over it in long windows (whole sentences, up to
 * 28 s, with the words around them), and the sentences it returns, each with
 * its own times, replace the live lines. The audio is dropped with the
 * offscreen page when the meeting is saved.
 */
import type { TimedText } from "../transcribe/protocol";
import { EchoGate, isMicPhantom, voicedMs } from "./echo";
import type { Speaker } from "./queue";
import { TARGET_RATE } from "./resample";
import { Segmenter, type Chunk } from "./segmenter";
import { cleanTranscript } from "./text";

/** Kept per source at most; a longer recording keeps its live transcript. */
export const MAX_KEEP_MS = 4 * 60 * 60_000;
const BLOCK = TARGET_RATE * 10;

/** One source's audio for the whole recording, as 16-bit samples in 10 s blocks. */
export class AudioStore {
  private blocks: Int16Array[] = [];
  private fill = 0;
  /** Samples stored. */
  length = 0;
  /** More came than `MAX_KEEP_MS`: the rest was not kept. */
  full = false;

  /** Where this source starts in the recording, ms (the mic opens after the tab). */
  constructor(readonly offsetMs = 0) {}

  push(block: Float32Array): void {
    if (this.full) return;
    if (((this.length + block.length) / TARGET_RATE) * 1000 > MAX_KEEP_MS) {
      this.full = true;
      return;
    }
    for (let i = 0; i < block.length; i++) {
      if (this.blocks.length === 0 || this.fill === BLOCK) {
        this.blocks.push(new Int16Array(BLOCK));
        this.fill = 0;
      }
      const v = Math.max(-1, Math.min(1, block[i]!));
      this.blocks[this.blocks.length - 1]![this.fill++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    this.length += block.length;
  }

  /** Samples `from` to `to` (sample indexes), as floats. */
  read(from = 0, to = this.length): Float32Array {
    const a = Math.max(0, from);
    const b = Math.min(this.length, to);
    const out = new Float32Array(Math.max(0, b - a));
    for (let i = a; i < b; i++) {
      const v = this.blocks[Math.floor(i / BLOCK)]![i % BLOCK]!;
      out[i - a] = v < 0 ? v / 0x8000 : v / 0x7fff;
    }
    return out;
  }

  get seconds(): number {
    return this.length / TARGET_RATE;
  }
}

/** A stretch for the model: whole sentences, from one source. */
export interface Window extends Chunk {
  speaker: Speaker;
}

/**
 * The stretches worth transcribing in one source, up to 28 s each, cut at
 * pauses. On the mic, stretches that only follow the call (its echo, without
 * headphones) are silenced first, so they are neither transcribed nor glued
 * into a window with the user's own words.
 */
export function windowsOf(store: AudioStore, speaker: Speaker, echo: EchoGate | null): Window[] {
  // Read in pieces: a long call held as floats at once would take a lot of memory.
  const step = TARGET_RATE * 300;
  const echoes: [number, number][] = [];
  if (speaker === "you" && echo) {
    const fine = new Segmenter({ offsetMs: store.offsetMs });
    const check = (parts: Chunk[]) => {
      for (const p of parts) {
        if (!echo.isEcho(p.audio, p.startMs)) continue;
        const from = Math.round(((p.startMs - store.offsetMs) * TARGET_RATE) / 1000);
        echoes.push([from, from + p.audio.length]);
      }
    };
    for (let i = 0; i < store.length; i += step) check(fine.push(store.read(i, i + step)));
    check(fine.flush());
  }
  const long = new Segmenter({ offsetMs: store.offsetMs, hangoverMs: 1_200, minMs: 8_000, maxMs: 28_000, preRollMs: 300 });
  const out: Window[] = [];
  for (let i = 0; i < store.length; i += step) {
    const piece = store.read(i, i + step);
    for (const [a, b] of echoes) {
      if (b <= i || a >= i + piece.length) continue;
      piece.fill(0, Math.max(0, a - i), Math.min(piece.length, b - i));
    }
    for (const c of long.push(piece)) out.push({ ...c, speaker });
  }
  for (const c of long.flush()) out.push({ ...c, speaker });
  return out;
}

/** The call's loudness over the whole recording, to find its echo on the mic afterwards. */
export function echoOf(call: AudioStore): EchoGate {
  const gate = new EchoGate(MAX_KEEP_MS);
  const step = TARGET_RATE * 60;
  for (let i = 0; i < call.length; i += step) gate.pushReference(call.read(i, i + step));
  return gate;
}

/** A line of the redone transcript, before it is named and numbered. */
export interface RedoneLine {
  speaker: Speaker;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * The model's sentences for one window, as lines with times in the
 * recording. Phantom phrases on the mic (Whisper's "Thank you." on a breath)
 * are dropped, like live.
 */
export function linesOf(window: Window, chunks: readonly TimedText[] | undefined, text: string): RedoneLine[] {
  const parts = chunks && chunks.length > 0 ? chunks : [{ start: 0, end: (window.endMs - window.startMs) / 1000, text }];
  const out: RedoneLine[] = [];
  for (const c of parts) {
    const clean = cleanTranscript(c.text);
    if (!clean) continue;
    const startMs = window.startMs + Math.round(c.start * 1000);
    const endMs = Math.max(startMs, window.startMs + Math.round(c.end * 1000));
    if (window.speaker === "you") {
      const a = Math.round((c.start * TARGET_RATE));
      const b = Math.round((c.end * TARGET_RATE));
      if (isMicPhantom(clean, voicedMs(window.audio.subarray(a, Math.max(a, b))))) continue;
    }
    // Whisper sometimes repeats its last sentence over silence at a window's end.
    const last = out.at(-1);
    if (last && last.text === clean) continue;
    out.push({ speaker: window.speaker, startMs, endMs, text: clean });
  }
  return out;
}

/** Both sources' lines, in the order they were said. */
export function inOrder(lines: RedoneLine[]): RedoneLine[] {
  return [...lines].sort((a, b) => a.startMs - b.startMs || (a.speaker === "others" ? -1 : 1));
}

/** Whisper's sentences with their times; an open end (the last one) runs to the end of the audio. */
export function timedChunks(
  outputs: { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }[],
  seconds: number,
): TimedText[] {
  const out: TimedText[] = [];
  for (const o of outputs) {
    for (const c of o.chunks ?? []) {
      const [start, end] = c.timestamp;
      const text = c.text.trim();
      if (text) out.push({ start: Math.max(0, start), end: Math.min(seconds, end ?? seconds), text });
    }
  }
  return out;
}
