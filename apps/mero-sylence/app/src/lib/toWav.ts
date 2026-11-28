/**
 * A recording the browser will not play, as a WAV it will. Recordings the
 * extension made before it recorded AAC are Opus in WebM, which some browsers
 * (Safari on older systems, iPhones) cannot play in an <audio> element but
 * can still decode. Decoded at 16 kHz mono, speech stays clear and an hour is
 * about 115 MB in memory.
 */

/** The rate the WAV is written at: enough for speech. */
export const WAV_RATE = 16_000;
/** Longer recordings are not converted: their WAV would not fit in memory comfortably. */
export const MAX_WAV_SECONDS = 2 * 60 * 60;

/** 16-bit PCM WAV of mono `samples` at `rate`. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** The channels of `buffer` mixed into one. */
export function mono(buffer: Pick<AudioBuffer, "numberOfChannels" | "length" | "getChannelData">): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / buffer.numberOfChannels;
  }
  return out;
}

/** A Blob's bytes (`Blob.arrayBuffer`, or a FileReader where a Blob has none). */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error("could not read the recording"));
    r.readAsArrayBuffer(blob);
  });
}

type Decoder = { decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> };

/** `blob` decoded by the browser and written as WAV. Throws when the browser cannot decode it either. */
export async function toWav(
  blob: Blob,
  decoder: () => Decoder = () => new OfflineAudioContext(1, 1, WAV_RATE),
): Promise<Blob> {
  const decoded = await decoder().decodeAudioData(await blobBytes(blob));
  if (decoded.duration > MAX_WAV_SECONDS) throw new Error("the recording is too long to convert in this browser");
  return encodeWav(mono(decoded), decoded.sampleRate);
}
