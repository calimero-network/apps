// ── Layer thumbnails ─────────────────────────────────────────────────────────
//
// The Layers panel used to call `toDataURL()` on each layer's FULL-RESOLUTION
// canvas on every render: a synchronous PNG encode of a document-sized buffer,
// per layer, and then a fresh `<img>` decode of each. Forty layers measured
// ~190ms of encoding alone per render, and the panel re-rendered on every zoom
// and pan step — which is most of why a 40-layer document felt frozen.
//
// A thumbnail is shown at 30 CSS px. So: downscale to that (×2 for HiDPI) first,
// encode the tiny canvas, and keep the URL until the layer's pixels actually
// change — `layerPixelVersion` bumps on every write path (see the "Pixel
// versions" note in layerCanvases), so it is the whole cache key alongside the
// canvas identity and size.

import { createCanvas, ctx2d } from "./raster";
import { layerPixelVersion } from "../store/layerCanvases";

/** Longest side of a generated thumbnail, in device px (30 CSS px at 2x). */
const THUMB_PX = 60;

interface Entry {
  canvas: HTMLCanvasElement;
  version: number;
  w: number;
  h: number;
  url: string;
}

const cache = new Map<string, Entry>();

/** A small data URL of a layer's pixels, regenerated only when they change. */
export function layerThumbUrl(id: string, source: HTMLCanvasElement): string {
  const version = layerPixelVersion(id);
  const hit = cache.get(id);
  if (hit && hit.canvas === source && hit.version === version
    && hit.w === source.width && hit.h === source.height) {
    return hit.url;
  }
  const scale = Math.min(1, THUMB_PX / Math.max(source.width, source.height));
  const small = createCanvas(source.width * scale, source.height * scale);
  const ctx = ctx2d(small);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const url = small.toDataURL();
  cache.set(id, { canvas: source, version, w: source.width, h: source.height, url });
  return url;
}

/** Drop thumbnails for layers not in `liveIds` (layers deleted, project switched). */
export function pruneLayerThumbs(liveIds: Set<string>): void {
  for (const id of [...cache.keys()]) if (!liveIds.has(id)) cache.delete(id);
}
