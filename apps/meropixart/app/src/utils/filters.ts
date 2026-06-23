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

export function applyFilter(src: HTMLCanvasElement, kind: FilterKind): HTMLCanvasElement {
  switch (kind) {
    case "blur": return viaCssFilter(src, "blur(2.5px)");
    case "grayscale": return viaCssFilter(src, "grayscale(1)");
    case "sepia": return viaCssFilter(src, "sepia(1)");
    case "invert": return viaCssFilter(src, "invert(1)");
    case "brighten": return viaCssFilter(src, "brightness(1.18)");
    case "darken": return viaCssFilter(src, "brightness(0.82)");
    case "sharpen": return convolve(src, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
    default: return src;
  }
}
