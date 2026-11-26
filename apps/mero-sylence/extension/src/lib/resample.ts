/** The speech models' input rate. */
export const TARGET_RATE = 16_000;

/** Channels averaged into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + ((ch[i] ?? 0) / channels.length);
  return out;
}

/**
 * A streaming linear resampler: feed blocks at `fromRate`, get blocks at
 * `toRate`, with no seam between blocks. A low-pass by averaging precedes
 * decimation so 48 kHz speech does not alias into the 0–8 kHz band.
 */
export class Resampler {
  private readonly step: number;
  private pos = 0;
  private last = 0;
  private readonly taps: number;
  private history: number[] = [];

  constructor(
    readonly fromRate: number,
    readonly toRate: number = TARGET_RATE,
  ) {
    if (fromRate <= 0 || toRate <= 0) throw new Error("rates must be positive");
    this.step = fromRate / toRate;
    this.taps = Math.max(1, Math.floor(this.step));
  }

  push(input: Float32Array): Float32Array {
    const filtered = this.lowpass(input);
    const out: number[] = [];
    // `pos` is the read position relative to the start of this block, where
    // index -1 is the previous block's last sample.
    while (this.pos < filtered.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : (filtered[i] as number);
      const b = i + 1 < filtered.length ? (filtered[i + 1] as number) : a;
      out.push(a + (b - a) * frac);
      this.pos += this.step;
    }
    this.pos -= filtered.length;
    if (filtered.length > 0) this.last = filtered[filtered.length - 1] as number;
    return Float32Array.from(out);
  }

  private lowpass(input: Float32Array): Float32Array {
    if (this.taps === 1) return input;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      this.history.push(input[i] as number);
      if (this.history.length > this.taps) this.history.shift();
      let sum = 0;
      for (const v of this.history) sum += v;
      out[i] = sum / this.history.length;
    }
    return out;
  }
}

/** Root mean square of a block: the level meter and the speech detector read it. */
export function rms(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (const v of block) sum += v * v;
  return Math.sqrt(sum / block.length);
}
