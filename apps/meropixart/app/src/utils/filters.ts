// ── Destructive raster filters (Image → Filters) ───────────────────────────────
//
// Each filter takes a source canvas and returns a NEW canvas with the effect
// baked in. Blur/grayscale/sepia/invert/brightness lean on the GPU-accelerated
// 2D `filter` property; sharpen runs a small convolution kernel by hand.

import type { FilterKind } from "../types";
import { createCanvas, ctx2d } from "./raster";

function viaCssFilter(src: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const ctx = ctx2d(out);
  ctx.filter = filter;
  ctx.drawImage(src, 0, 0);
  return out;
}

/** 3×3 convolution that preserves alpha (used for sharpen). */
function convolve(src: HTMLCanvasElement, kernel: number[]): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const sctx = ctx2d(src);
  const input = sctx.getImageData(0, 0, w, h);
  const out = createCanvas(w, h);
  const octx = ctx2d(out);
  const output = octx.createImageData(w, h);
  const s = input.data;
  const d = output.data;
  const side = 3;
  const half = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < side; ky++) {
        for (let kx = 0; kx < side; kx++) {
          const px = Math.min(w - 1, Math.max(0, x + kx - half));
          const py = Math.min(h - 1, Math.max(0, y + ky - half));
          const k = kernel[ky * side + kx];
          const i = (py * w + px) * 4;
          r += s[i] * k;
          g += s[i + 1] * k;
          b += s[i + 2] * k;
        }
      }
      const o = (y * w + x) * 4;
      d[o] = Math.min(255, Math.max(0, r));
      d[o + 1] = Math.min(255, Math.max(0, g));
      d[o + 2] = Math.min(255, Math.max(0, b));
      d[o + 3] = s[o + 3]; // keep original alpha
    }
  }
  octx.putImageData(output, 0, 0);
  return out;
}

/** Directional (horizontal) blur — stacks shifted, alpha-weighted copies. */
function motionBlur(src: HTMLCanvasElement, radius = 8): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const ctx = ctx2d(out);
  const n = radius * 2 + 1;
  ctx.globalAlpha = 1 / n;
  for (let dx = -radius; dx <= radius; dx++) ctx.drawImage(src, dx, 0);
  ctx.globalAlpha = 1;
  return out;
}

/** Monochrome film-grain noise added to RGB (alpha preserved). */
function addNoise(src: HTMLCanvasElement, amount = 32): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const sctx = ctx2d(src);
  const octx = ctx2d(out);
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 2 * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Mosaic / pixelate by downscaling then nearest-neighbour upscaling. */
function pixelate(src: HTMLCanvasElement, block = 10): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const sw = Math.max(1, Math.round(w / block));
  const sh = Math.max(1, Math.round(h / block));
  const small = createCanvas(sw, sh);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(src, 0, 0, sw, sh);
  const out = createCanvas(w, h);
  const octx = ctx2d(out);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
  return out;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function applyFilter(src: HTMLCanvasElement, kind: FilterKind): HTMLCanvasElement {
  switch (kind) {
    case "blur": return viaCssFilter(src, "blur(2.5px)");
    case "grayscale": return viaCssFilter(src, "grayscale(1)");
    case "sepia": return viaCssFilter(src, "sepia(1)");
    case "invert": return viaCssFilter(src, "invert(1)");
    case "brighten": return viaCssFilter(src, "brightness(1.18)");
    case "darken": return viaCssFilter(src, "brightness(0.82)");
    case "sharpen": return convolve(src, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
    case "motion-blur": return motionBlur(src, Math.max(2, Math.round(src.width * 0.012)));
    case "noise": return addNoise(src, 36);
    case "pixelate": return pixelate(src, Math.max(4, Math.round(Math.min(src.width, src.height) / 48)));
    default: return src;
  }
}
