// ── Luma capture helpers (the frontend half of the Task-3 probe) ───────────────
//
// Mero Stream's whole design (approach 3) is: the browser captures a webcam
// frame, DOWNSCALES it to a tiny single-channel luma buffer, and hands the RAW
// luma to the contract, which encodes it in WASM. There is no WebRTC — the media
// path runs entirely through the replicated contract state.
//
// These three helpers are deliberately framework-free and side-effect-light so
// they are trivially unit-testable (see luma.test.ts):
//
//   rgbaToLuma      canvas RGBA ImageData → 1-byte-per-pixel luma
//   paintLuma       decoded luma → grayscale RGBA on a canvas (the receive side)
//   captureFrameLuma  <video> → downscale canvas → luma bytes (the send side)
//
// The luma weights use an INTEGER approximation of Rec.601 grayscale:
//
//   Y = (77*R + 150*G + 29*B) >> 8      (77+150+29 = 256, so the >>8 normalizes)
//
// Integer-only on purpose — it mirrors the contract's integer-only, deterministic
// codec (constraint C1). No float rounding anywhere in the media path.

/**
 * Convert canvas RGBA pixels to a single-channel luma buffer (1 byte/pixel,
 * row-major). Pure — takes an `ImageData` (or anything shaped like one) and
 * returns a fresh `Uint8Array` of `width * height` luma samples.
 */
export function rgbaToLuma(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData;
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Integer Rec.601-ish luma; >>8 keeps it exact and float-free (C1 parity).
    out[p] = (77 * r + 150 * g + 29 * b) >> 8;
  }
  return out;
}

/**
 * Paint a decoded luma buffer onto a 2D canvas context as grayscale RGBA. This
 * is the receive side: a peer's `get_frame` returns raw luma (`pixels`), which
 * we expand to R=G=B=luma, A=255 and blit with `putImageData`.
 *
 * Kept context-generic (only needs `createImageData` + `putImageData`) so the
 * pure pixel math is testable without a real browser 2D context.
 */
export function paintLuma(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pixels: number[] | Uint8Array,
): void {
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const n = width * height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = pixels[p] ?? 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Capture the current `<video>` frame, downscale it onto a `w × h` scratch
 * canvas, and return the luma bytes. This is the send side: the returned buffer
 * is exactly what gets handed to the contract's `encode_frame` (as a plain
 * number[]).
 *
 * `w`/`h` are intentionally tiny (default use is 64×48) — geometry is the
 * primary knob on the load curve, and the contract caps a raw frame at 256×256.
 */
export function captureFrameLuma(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
): Uint8Array {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  // drawImage with explicit dst size does the downscale for us.
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return rgbaToLuma(img);
}
