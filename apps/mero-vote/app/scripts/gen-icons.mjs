// Generates Mero Vote's icon set into app/public/ with zero dependencies:
//   favicon.ico (16/32/48 PNG-compressed entries), apple-touch-icon.png,
//   icon-192.png, icon-512.png.
// The mark — a ballot with a check going into a box — is kept in sync by hand
// with public/favicon.svg, the only asset here that is NOT generated.
// Run: node scripts/gen-icons.mjs
//
// Adapted from kv-store's generator (itself from mero-pass's); the rasteriser
// and encoders are unchanged, only the art differs.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

// ---- rasteriser ------------------------------------------------------------
// Art is written once in a 64×64 "design unit" space and sampled at any output
// size. SS×SS samples per output pixel is the whole anti-aliasing story: shapes
// are hard predicates, the box-downsample turns partial coverage into a smooth
// edge. That keeps every primitive a one-line function and needs no dependency.

const SS = 4;

const surface = (size) => ({
  size,
  n: size * SS,
  d: new Float32Array(size * SS * size * SS * 4),
});

/**
 * Composite `inside` (a predicate in design units) over the surface with
 * `color` (a paint in design units), source-over. `fit` optionally scales the
 * art down and centres it, for the full-bleed variants.
 */
function draw(c, inside, color, fit) {
  const s = fit ?? 1;
  const o = 32 * (1 - s);
  for (let y = 0; y < c.n; y++) {
    for (let x = 0; x < c.n; x++) {
      const u = (((x + 0.5) / c.n) * 64 - o) / s;
      const v = (((y + 0.5) / c.n) * 64 - o) / s;
      if (!inside(u, v)) continue;
      const [r, g, b, a = 1] = color(u, v);
      const i = (y * c.n + x) * 4;
      const ia = c.d[i + 3];
      const out = a + ia * (1 - a);
      if (out <= 0) continue;
      c.d[i] = (r * a + c.d[i] * ia * (1 - a)) / out;
      c.d[i + 1] = (g * a + c.d[i + 1] * ia * (1 - a)) / out;
      c.d[i + 2] = (b * a + c.d[i + 2] * ia * (1 - a)) / out;
      c.d[i + 3] = out;
    }
  }
}

/** Box-downsample to straight-alpha RGBA. Colour is alpha-weighted so fully
 *  transparent samples never wash the edge toward black. */
function resolve(c) {
  const data = new Uint8Array(c.size * c.size * 4);
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * c.n + x * SS + sx) * 4;
          const al = c.d[i + 3];
          r += c.d[i] * al;
          g += c.d[i + 1] * al;
          b += c.d[i + 2] * al;
          a += al;
        }
      }
      const o = (y * c.size + x) * 4;
      data[o] = a ? Math.round(r / a) : 0;
      data[o + 1] = a ? Math.round(g / a) : 0;
      data[o + 2] = a ? Math.round(b / a) : 0;
      data[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return { w: c.size, h: c.size, data };
}

// ---- shapes (design units) -------------------------------------------------
// `rrect`, plus `segment` for the check mark's two strokes.

const rrect = (x, y, w, h, r) => (u, v) => {
  if (u < x || v < y || u > x + w || v > y + h) return false;
  const dx = Math.max(x + r - u, 0, u - (x + w - r));
  const dy = Math.max(y + r - v, 0, v - (y + h - r));
  return dx * dx + dy * dy <= r * r;
};

/** A stroke: every point within `w/2` of the segment (x1,y1)–(x2,y2). */
const segment = (x1, y1, x2, y2, w) => (u, v) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
  const px = x1 + t * dx - u;
  const py = y1 + t * dy - v;
  return px * px + py * py <= (w / 2) * (w / 2);
};

// ---- paints ----------------------------------------------------------------

const rgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const solid = (hex, a = 1) => {
  const [r, g, b] = rgb(hex);
  return () => [r, g, b, a];
};

// ---- PNG / ICO encoders ----------------------------------------------------

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

function encodePNG(img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0; // filter: none
    Buffer.from(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4)).copy(
      raw,
      y * (img.w * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO container with PNG-compressed entries (understood by every browser). */
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((p) => p.png)]);
}


// ---- art -------------------------------------------------------------------
// A ballot card half into a box. The card is pale with a green check; the box
// is Calimero green with a dark slot the card disappears into. Drawn card
// first, box over it, so the box hides the card's lower half. Same numbers as
// public/favicon.svg.

const BG = "#0f1417";
const CARD = "#e8f3ee";
const CHECK = "#16a34a";
const BOX = "#4ade80";
const SLOT = "#0f1417";

function mark(c, fit) {
  draw(c, rrect(21, 8, 22, 28, 3), solid(CARD), fit);
  draw(c, segment(26, 20, 30.5, 24.5, 3.6), solid(CHECK), fit);
  draw(c, segment(30.5, 24.5, 38, 15, 3.6), solid(CHECK), fit);
  draw(c, rrect(10, 30, 44, 26, 5), solid(BOX), fit);
  draw(c, rrect(17, 29, 30, 5, 2.5), solid(SLOT), fit);
}

// ---- variants --------------------------------------------------------------
// Two framings, and the difference is not cosmetic:
//   • rounded — the browser-tab favicon. Nothing masks it, so it draws its own
//     corners.
//   • full-bleed — everything that becomes an OS icon. iOS, Chrome's "install"
//     and the per-app `.app` the desktop writes into ~/Applications (see
//     tauri-app `launcher.rs`, which fetches this app's registry icon — i.e.
//     icon-512.png, via [package.metadata.calimero].icon — and runs it through
//     `sips`/`iconutil`) all apply their own mask. A pre-rounded square gets
//     its corners cut TWICE, which is what the icons this script replaces did:
//     they were rounded AND transparent outside the radius, while
//     site.webmanifest advertised them `purpose: "any maskable"`. So the
//     background bleeds edge to edge here and stays fully opaque.
//
// The mark is inset instead, to 80% — the fleet's value, which keeps it inside
// the maskable safe zone.

const render = (size, rounded) => {
  const c = surface(size);
  draw(c, rrect(0, 0, 64, 64, rounded ? 14 : 0), solid(BG));
  mark(c, rounded ? 1 : 0.8);
  return resolve(c);
};

writeFileSync(
  join(OUT, "favicon.ico"),
  encodeICO([16, 32, 48].map((size) => ({ size, png: encodePNG(render(size, true)) }))),
);
writeFileSync(join(OUT, "apple-touch-icon.png"), encodePNG(render(180, false)));
writeFileSync(join(OUT, "icon-192.png"), encodePNG(render(192, false)));
writeFileSync(join(OUT, "icon-512.png"), encodePNG(render(512, false)));
console.log("wrote favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png →", OUT);
