/**
 * An audio tap: mixes its input to mono and posts blocks of ~85 ms (at
 * 48 kHz) to the page, which resamples them to 16 kHz. Runs on the audio
 * thread, so it does nothing else.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BLOCK = 4096;

class Tap extends AudioWorkletProcessor {
  private buffer = new Float32Array(BLOCK);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i] ?? 0;
      this.buffer[this.filled++] = sum / channels.length;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("sylence-tap", Tap);
