/**
 * Cuts one source's 16 kHz audio into stretches of speech for the model: an
 * energy detector with an adaptive noise floor. Silence is dropped, a stretch
 * ends after `hangoverMs` of quiet, and none is longer than `maxMs` (Whisper
 * reads 30 s at most) or, unless the speaker stops, shorter than `minMs`.
 */
import { rms, TARGET_RATE } from "./resample";

export interface Chunk {
  /** From the start of the recording, ms. */
  startMs: number;
  endMs: number;
  audio: Float32Array;
}

export interface SegmenterOptions {
  rate?: number;
  /** Analysis frame, ms. */
  frameMs?: number;
  /** Quiet that ends a stretch, ms. */
  hangoverMs?: number;
  /** Audio kept before the first loud frame, ms (the start of a word is quiet). */
  preRollMs?: number;
  minMs?: number;
  maxMs?: number;
  /** Voiced audio a stretch needs to be kept at all, ms (a cough is not speech). */
  minVoicedMs?: number;
  /** The level below which nothing is speech, whatever the noise floor. */
  minThreshold?: number;
  /** How far above the noise floor speech is. */
  floorRatio?: number;
  /** Where this source's audio starts in the recording, ms. */
  offsetMs?: number;
  /** The first audio, ms, only measures the room's noise (never speech). */
  calibrateMs?: number;
}

const DEFAULTS: Required<SegmenterOptions> = {
  rate: TARGET_RATE,
  frameMs: 30,
  hangoverMs: 700,
  preRollMs: 240,
  minMs: 1_000,
  maxMs: 20_000,
  minVoicedMs: 300,
  minThreshold: 0.008,
  floorRatio: 3,
  offsetMs: 0,
  calibrateMs: 600,
};

/** The loudest a room's noise is taken to be at the start (RMS). */
const MAX_FLOOR = 0.015;

export class Segmenter {
  private readonly o: Required<SegmenterOptions>;
  private readonly frameLen: number;
  private pending = new Float32Array(0);
  /** Samples consumed into frames so far. */
  private consumed = 0;
  private floor = 0;
  private preRoll: Float32Array[] = [];
  private current: Float32Array[] | null = null;
  private currentStart = 0;
  private currentLen = 0;
  private voicedFrames = 0;
  private quietFrames = 0;

  constructor(options: SegmenterOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.frameLen = Math.round((this.o.rate * this.o.frameMs) / 1000);
    this.floor = this.o.minThreshold / this.o.floorRatio;
  }

  /** The level the detector currently calls speech. */
  get threshold(): number {
    return Math.max(this.o.minThreshold, this.floor * this.o.floorRatio);
  }

  /** Whether a stretch of speech is open. */
  get speaking(): boolean {
    return this.current !== null;
  }

  push(samples: Float32Array): Chunk[] {
    const out: Chunk[] = [];
    const all = new Float32Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let i = 0;
    for (; i + this.frameLen <= all.length; i += this.frameLen) {
      const chunk = this.frame(all.slice(i, i + this.frameLen));
      if (chunk) out.push(chunk);
    }
    this.pending = all.slice(i);
    return out;
  }

  /** Ends the open stretch, if any (the recording stopped). */
  flush(): Chunk[] {
    if (this.pending.length > 0 && this.current) {
      this.current.push(this.pending);
      this.currentLen += this.pending.length;
    }
    this.consumed += this.pending.length;
    this.pending = new Float32Array(0);
    const c = this.close(true);
    return c ? [c] : [];
  }

  private frame(frame: Float32Array): Chunk | null {
    const level = rms(frame);
    const frameStart = this.consumed;
    this.consumed += frame.length;
    if ((frameStart / this.o.rate) * 1000 < this.o.calibrateMs) {
      // Calibration: the room's noise is the quietest the first frames get,
      // capped so someone already talking can't make speech the floor.
      this.floor = Math.min(frameStart === 0 ? level : Math.min(this.floor, level), MAX_FLOOR);
      this.keepPreRoll(frame);
      return null;
    }
    const loud = level >= this.threshold;
    // The floor drops quickly to quieter audio, rises slowly in quiet, and
    // creeps up very slowly under sustained sound (a fan that started).
    const rate = level < this.floor ? 0.2 : loud ? 0.0005 : 0.02;
    this.floor += (level - this.floor) * rate;

    if (!this.current) {
      if (loud) {
        const pre = this.preRoll;
        const preLen = pre.reduce((n, f) => n + f.length, 0);
        this.current = [...pre, frame];
        this.currentStart = frameStart - preLen;
        this.currentLen = preLen + frame.length;
        this.voicedFrames = 1;
        this.quietFrames = 0;
        this.preRoll = [];
        return null;
      }
      this.keepPreRoll(frame);
      return null;
    }

    if (((this.currentLen + frame.length) / this.o.rate) * 1000 > this.o.maxMs) {
      // At the maximum: close the stretch and start the next with this frame.
      const done = this.close(true);
      this.current = [frame];
      this.currentStart = frameStart;
      this.currentLen = frame.length;
      this.voicedFrames = loud ? 1 : 0;
      this.quietFrames = loud ? 0 : 1;
      return done;
    }
    this.current.push(frame);
    this.currentLen += frame.length;
    if (loud) {
      this.voicedFrames += 1;
      this.quietFrames = 0;
    } else {
      this.quietFrames += 1;
    }
    const quietMs = this.quietFrames * this.o.frameMs;
    if (quietMs >= this.o.hangoverMs) {
      // A short phrase waits for more speech, unless the quiet is long (the speaker stopped).
      const voicedMs = this.voicedFrames * this.o.frameMs;
      if (voicedMs >= this.o.minMs || quietMs >= this.o.hangoverMs * 3) return this.close(false);
    }
    return null;
  }

  private keepPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame);
    const keep = Math.ceil(this.o.preRollMs / this.o.frameMs);
    while (this.preRoll.length > keep) this.preRoll.shift();
  }

  private close(force: boolean): Chunk | null {
    const parts = this.current;
    this.current = null;
    if (!parts) return null;
    let frames = parts;
    let len = this.currentLen;
    // Trailing quiet beyond a little tail is not sent to the model.
    if (!force || this.quietFrames > 0) {
      const tail = Math.max(0, this.quietFrames - Math.ceil(200 / this.o.frameMs));
      for (let t = 0; t < tail && frames.length > 1; t++) {
        len -= (frames[frames.length - 1] as Float32Array).length;
        frames = frames.slice(0, -1);
      }
    }
    const voicedMs = this.voicedFrames * this.o.frameMs;
    this.voicedFrames = 0;
    this.quietFrames = 0;
    if (voicedMs < this.o.minVoicedMs) return null;
    const audio = new Float32Array(len);
    let at = 0;
    for (const f of frames) {
      audio.set(f, at);
      at += f.length;
    }
    const startMs = this.o.offsetMs + Math.round((Math.max(0, this.currentStart) / this.o.rate) * 1000);
    return { startMs, endMs: startMs + Math.round((len / this.o.rate) * 1000), audio };
  }
}
