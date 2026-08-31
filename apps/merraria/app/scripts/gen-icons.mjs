// Generates every static brand asset into app/public/ with zero dependencies:
//   favicon.ico (16/32/48 PNG-compressed entries), apple-touch-icon.png,
//   icon-192.png, icon-512.png, og.png (1200×630 social card).
// Art is the same flat grass/dirt tile + pickaxe as LOGO_SVG in
// src/ui/landing.ts — merraria's 2D answer to mero-blocks' iso cube.
// Run: node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

// ---- tiny raster canvas --------------------------------------------------

const canvas = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });

function put(c, x, y, [r, g, b, a = 255]) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = r;
  c.data[i + 1] = g;
  c.data[i + 2] = b;
  c.data[i + 3] = a;
}

function rect(c, x0, y0, w, h, col) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(c, x, y, col);
}

/** scanline polygon fill (convex or not) */
function poly(c, pts, col) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(c.h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by) continue;
      const t = (y + 0.5 - ay) / (by - ay);
      if (t >= 0 && t < 1) xs.push(ax + t * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) put(c, x, y, col);
    }
  }
}

// ---- PNG encoder ----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(c) {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0; // filter: none
    Buffer.from(c.data.subarray(y * c.w * 4, (y + 1) * c.w * 4)).copy(
      raw,
      y * (c.w * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO container with PNG-compressed entries (all modern browsers) */
function encodeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

// ---- the grass tile + pickaxe ----------------------------------------------

const GRASS = [79, 156, 58];
const GRASS_HI = [111, 196, 84];
const DIRT = [138, 90, 51];
const DIRT_DK = [108, 68, 38];
const HANDLE = [107, 82, 51];
const STEEL = [200, 204, 212];
const STEEL_DK = [150, 156, 168];

/** flat 2D tile (LOGO_SVG geometry, 64×64 viewBox) at x,y scaled to `size` */
function drawTile(c, x, y, size) {
  const s = size / 64;
  const p = (px, py) => [x + px * s, y + py * s];
  const R = (px, py, w, h, col) =>
    rect(c, Math.round(x + px * s), Math.round(y + py * s), Math.round(w * s), Math.round(h * s), col);
  // dirt body with darker right/bottom edges for depth
  R(2, 2, 60, 60, DIRT);
  R(56, 2, 6, 60, DIRT_DK);
  R(2, 56, 60, 6, DIRT_DK);
  // dirt speckles
  for (const [sx, sy] of [[12, 34], [24, 46], [38, 38], [48, 28], [16, 50], [42, 52]])
    R(sx, sy, 4, 4, DIRT_DK);
  // grass turf on top
  R(2, 2, 60, 16, GRASS);
  R(2, 2, 60, 5, GRASS_HI);
  for (const [sx, sh] of [[8, 6], [20, 4], [34, 7], [48, 5]]) R(sx, 18, 5, sh, GRASS);
  // pickaxe: diagonal handle + two steel prongs
  poly(c, [p(16, 58), p(11, 53), p(42, 22), p(47, 27)], HANDLE);
  poly(c, [p(24, 8), p(30, 4), p(50, 18), p(44, 25)], STEEL);
  poly(c, [p(56, 40), p(60, 34), p(46, 14), p(40, 20)], STEEL_DK);
}

function icon(size, opaque = false) {
  const c = canvas(size, size);
  if (opaque) rect(c, 0, 0, size, size, [11, 14, 20]);
  const tile = opaque ? size * 0.74 : size;
  drawTile(c, (size - tile) / 2, (size - tile) / 2, tile);
  return c;
}

// ---- 5×7 pixel font (glyphs used by the OG card) ---------------------------

const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function text(c, str, x, y, scale, col) {
  let cx = x;
  for (const ch of str) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++)
        if (glyph[gy][gx] === "1") rect(c, cx + gx * scale, y + gy * scale, scale, scale, col);
    cx += 6 * scale;
  }
  return cx;
}

// ---- OG card ----------------------------------------------------------------

function ogCard() {
  const c = canvas(1200, 630);
  // landing-page gradient: #0b0e14 → #141c2b → #1d2a1f
  const stops = [
    [0, [11, 14, 20]],
    [0.45, [20, 28, 43]],
    [1, [29, 42, 31]],
  ];
  for (let y = 0; y < c.h; y++) {
    const t = y / (c.h - 1);
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i + 1 < stops.length; i++)
      if (t >= stops[i][0] && t <= stops[i + 1][0]) [a, b] = [stops[i], stops[i + 1]];
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    const col = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * f));
    rect(c, 0, y, c.w, 1, col);
  }
  // rolling 2D terrain strip along the bottom — grass over dirt, like in-game
  const B = 30;
  for (let i = 0; i * B < c.w; i++) {
    const height = 2 + Math.round(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 2);
    for (let row = 0; row < height; row++) {
      const top = row === height - 1;
      const shade = i % 2 === 0 ? 0 : -12;
      const col = (top ? GRASS : DIRT).map((v) => Math.max(0, v + shade));
      rect(c, i * B, c.h - (row + 1) * B, B, B, col);
    }
  }
  drawTile(c, 105, 145, 290);
  text(c, "MERRARIA", 455, 190, 11, [255, 255, 255]);
  text(c, "P2P MINING SANDBOX", 457, 320, 6, [184, 198, 214]);
  text(c, "ON CALIMERO", 457, 380, 6, [143, 163, 186]);
  return c;
}

// ---- write everything --------------------------------------------------------

writeFileSync(
  join(OUT, "favicon.ico"),
  encodeICO([16, 32, 48].map((size) => ({ size, png: encodePNG(icon(size)) }))),
);
writeFileSync(join(OUT, "apple-touch-icon.png"), encodePNG(icon(180, true)));
writeFileSync(join(OUT, "icon-192.png"), encodePNG(icon(192, true)));
writeFileSync(join(OUT, "icon-512.png"), encodePNG(icon(512, true)));
writeFileSync(join(OUT, "og.png"), encodePNG(ogCard()));
console.log("wrote favicon.ico, apple-touch-icon.png, icon-192/512.png, og.png →", OUT);
