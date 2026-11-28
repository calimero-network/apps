/**
 * Whether the recorder's microphone is really giving sound. Chrome can hand
 * the offscreen page a microphone that stays silent: muted at the system,
 * the wrong device chosen, or taken by the call app. The call side keeps
 * talking while the mic says nothing; after a minute of that, once, the
 * person is told, so a meeting isn't recorded with their side missing.
 */

/** Below this level a block is silence (RMS of 16 kHz float samples). */
export const MIC_SILENCE_LEVEL = 0.004;
/** How long the mic may stay silent while the call talks before the person is told. */
export const MIC_SILENT_MS = 60_000;

export class MicWatch {
  private lastMic: number;
  private callTalked = false;
  private told = false;

  constructor(startedAt: number) {
    this.lastMic = startedAt;
  }

  /** A block of sound from `speaker` at `level`. */
  heard(speaker: "you" | "others", level: number, now: number): void {
    if (level < MIC_SILENCE_LEVEL) return;
    if (speaker === "you") {
      this.lastMic = now;
      // Sound again: a later silence is worth telling about once more.
      this.told = false;
    } else this.callTalked = true;
  }

  /** True once, when the mic has said nothing for a minute while the call talked. */
  silent(now: number): boolean {
    if (this.told || !this.callTalked || now - this.lastMic < MIC_SILENT_MS) return false;
    this.told = true;
    return true;
  }
}
