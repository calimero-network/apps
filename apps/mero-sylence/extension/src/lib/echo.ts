/**
 * Tells the call leaking into the microphone apart from the user talking.
 *
 * Without headphones the microphone hears the other side through the
 * speakers. Echo cancellation removes most of it, but what is left can still
 * be loud enough for the speech detector, and the line comes out as "You"
 * saying what someone else said (or Whisper's "Thank you." on the leftover
 * hiss). Leaked audio follows the call's loudness, word for word, a few
 * hundred ms later; the user's own voice does not. So a microphone stretch
 * whose loudness envelope correlates with the call's is an echo.
 */
import { TARGET_RATE } from "./resample";

/** Envelope frame, ms. */
export const FRAME_MS = 20;
const FRAME = (TARGET_RATE * FRAME_MS) / 1000;
/** How long the call's envelope is kept, ms. */
const KEEP_MS = 120_000;
/** Lags tried: the mic hears the call this much later (or, with clock skew, slightly earlier). */
const MIN_LAG_MS = -200;
const MAX_LAG_MS = 800;
/** Above this, the mic stretch is taken to be the call (Pearson r of log envelopes). */
export const ECHO_R = 0.65;
/** The call must have been audible this share of the stretch to be the source. */
const MIN_ACTIVE = 0.25;
const ACTIVE_RMS = 0.01;

const db = (v: number) => Math.log10(v * v + 1e-8);

function envelope(audio: Float32Array): Float32Array {
  const n = Math.floor(audio.length / FRAME);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * FRAME; j < (i + 1) * FRAME; j++) sum += audio[j]! * audio[j]!;
    out[i] = Math.sqrt(sum / FRAME);
  }
  return out;
}

function pearson(a: Float32Array, b: Float32Array, bOffset: number): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    const j = i + bOffset;
    if (j < 0 || j >= b.length) continue;
    sa += a[i]!;
    sb += b[j]!;
    n++;
  }
  if (n < 10) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const j = i + bOffset;
    if (j < 0 || j >= b.length) continue;
    const x = a[i]! - ma;
    const y = b[j]! - mb;
    cov += x * y;
    va += x * x;
    vb += y * y;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

export class EchoGate {
  /** The call's envelope (RMS per frame), from frame `first`. */
  private ref: number[] = [];
  private first = 0;
  private pending = new Float32Array(0);

  /** The call's audio at 16 kHz, in order, from the start of the recording. */
  pushReference(block: Float32Array): void {
    const all = new Float32Array(this.pending.length + block.length);
    all.set(this.pending);
    all.set(block, this.pending.length);
    const frames = Math.floor(all.length / FRAME);
    const env = envelope(all.subarray(0, frames * FRAME));
    for (const v of env) this.ref.push(v);
    this.pending = all.slice(frames * FRAME);
    const keep = KEEP_MS / FRAME_MS;
    if (this.ref.length > keep * 1.5) {
      const drop = this.ref.length - keep;
      this.ref = this.ref.slice(drop);
      this.first += drop;
    }
  }

  /**
   * How closely a microphone stretch follows the call (0–1), for the
   * stretch's audio starting at `startMs` of the recording.
   */
  similarity(audio: Float32Array, startMs: number): number {
    const mic = envelope(audio);
    if (mic.length < 10) return 0;
    const start = Math.round(startMs / FRAME_MS) - this.first;
    // Mic frame i holds what the call played at frame start + i - lag.
    const base = Math.max(0, start - MAX_LAG_MS / FRAME_MS);
    const window = this.ref.slice(base, Math.max(base, start + mic.length - MIN_LAG_MS / FRAME_MS));
    const active = window.filter((v) => v > ACTIVE_RMS).length;
    if (active < mic.length * MIN_ACTIVE) return 0;
    const ref = Float32Array.from(window, db);
    const m = Float32Array.from(mic, db);
    let best = 0;
    for (let lag = MIN_LAG_MS / FRAME_MS; lag <= MAX_LAG_MS / FRAME_MS; lag++) {
      const offset = start - lag - base;
      best = Math.max(best, pearson(m, ref, offset));
    }
    return best;
  }

  isEcho(audio: Float32Array, startMs: number): boolean {
    return this.similarity(audio, startMs) >= ECHO_R;
  }
}

/** What Whisper writes for a breath or hiss on an open microphone, more than for speech. */
const MIC_PHANTOMS = /^(thank you( very much| so much)?|thanks( a lot)?|bye( bye)?|okay|ok|oh|hmm+|mm+|uh+|um+|yeah|i'm sorry|sorry)[.!?]*$/i;

/**
 * A short stock phrase on the microphone with hardly any voice behind it: a
 * phantom, not the user talking. `voicedMs` is how long the stretch was
 * clearly louder than speech's minimum.
 */
export function isMicPhantom(text: string, voicedMs: number): boolean {
  return MIC_PHANTOMS.test(text.trim()) && voicedMs < 900;
}

/** How long a stretch is clearly voiced, ms. */
export function voicedMs(audio: Float32Array, level = 0.02): number {
  return envelope(audio).filter((v) => v > level).length * FRAME_MS;
}
