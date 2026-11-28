import { describe, expect, it } from "vitest";
import { MAX_WAV_SECONDS, blobBytes, encodeWav, mono, toWav } from "./toWav";

async function bytes(b: Blob): Promise<DataView> {
  return new DataView(await blobBytes(b));
}
const str = (v: DataView, at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

describe("a recording as WAV", () => {
  it("writes a 16-bit mono PCM WAV every browser plays", async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000);
    expect(wav.type).toBe("audio/wav");
    const v = await bytes(wav);
    expect(str(v, 0, 4)).toBe("RIFF");
    expect(str(v, 8, 4)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768]);
  });

  it("mixes stereo into one channel", () => {
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([0, 1]);
    expect(Array.from(mono({ numberOfChannels: 2, length: 2, getChannelData: (c: number) => (c ? r : l) }))).toEqual([0.5, 0.5]);
  });

  it("decodes with the browser and writes it out", async () => {
    const samples = new Float32Array(16_000).fill(0.25);
    const wav = await toWav(new Blob([new Uint8Array(10)], { type: "audio/webm" }), () => ({
      decodeAudioData: async () =>
        ({ numberOfChannels: 1, length: samples.length, sampleRate: 16_000, duration: 1, getChannelData: () => samples }) as unknown as AudioBuffer,
    }));
    expect((await bytes(wav)).getUint32(40, true)).toBe(32_000);
  });

  it("refuses one too long to hold in memory", async () => {
    await expect(
      toWav(new Blob([new Uint8Array(10)]), () => ({
        decodeAudioData: async () => ({ duration: MAX_WAV_SECONDS + 1 }) as unknown as AudioBuffer,
      })),
    ).rejects.toThrow(/too long/);
  });
});
