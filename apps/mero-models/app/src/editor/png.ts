import { zlibSync } from "fflate";

/**
 * A PNG encoder for generated textures: 8-bit RGBA, no filtering, zlib from
 * fflate. Deterministic — the same pixels always give the same bytes, so a
 * regenerated texture that did not change is the same blob.
 */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error("pixel data does not match the image size");
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 6 });
  const chunks: [string, Uint8Array][] = [
    ["IHDR", ihdr(width, height)],
    ["IDAT", idat],
    ["IEND", new Uint8Array(0)],
  ];
  const total = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0);
  const out = new Uint8Array(total);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  let o = 8;
  for (const [type, data] of chunks) {
    view.setUint32(o, data.length);
    for (let i = 0; i < 4; i += 1) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    view.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

function ihdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d[8] = 8; // bit depth
  d[9] = 6; // RGBA
  return d;
}
