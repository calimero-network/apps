import { mapLimit } from "../utils/concurrency";
import { bytesToImage, canvasToPngBytes, createCanvas, ctx2d } from "../utils/raster";
import type { PixartClient, TileWrite } from "./pixart";

/**
 * A layer's pixels (and its mask) as 256 × 256 PNG tiles, each a blob.
 *
 * v1 re-uploaded the whole layer as one PNG after every stroke. Here a commit
 * compares each tile of the canvas with what was last loaded or written for it
 * and uploads only the tiles that changed (a tile now fully transparent is
 * removed), so a brush dab in a corner of a 4K layer writes one tile, not the
 * layer. Loading reads the tile list a page at a time and draws each tile.
 */
export const TILE = 256;

export type Plane = "pixels" | "mask";

/** What the tile code needs from the session. */
export interface TileDeps {
  pixart: Pick<PixartClient, "updateLayerContent" | "updateLayerMask" | "getLayerTiles">;
  uploadBlob(data: ArrayBuffer | Uint8Array, app: string): Promise<{ blobId: string }>;
  getBlob(blobId: string, app: string): Promise<ArrayBuffer>;
}

/** Uploads running at once during a commit. */
const UPLOADS = 4;
/** Downloads running at once during a load. */
const DOWNLOADS = 6;

/**
 * `${app}/${layer}/${plane}` → tile `"tx,ty"` → signature of what the node
 * holds there. A layer absent from this map has never been loaded or written in
 * this page, so its first commit writes every tile (and removes every empty one).
 */
const known = new Map<string, Map<string, string>>();

const planeKey = (app: string, layer: string, plane: Plane) => `${app}/${layer}/${plane}`;

/** Forget every tile signature (switching documents). */
export function forgetAllTiles(): void {
  known.clear();
}

/** Forget one layer's signatures, so its next commit writes it whole. */
export function forgetLayerTiles(app: string, layer: string): void {
  known.delete(planeKey(app, layer, "pixels"));
  known.delete(planeKey(app, layer, "mask"));
}

/** The tile grid of a `width` × `height` raster. */
export function grid(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.ceil(Math.max(1, width) / TILE), rows: Math.ceil(Math.max(1, height) / TILE) };
}

/**
 * A signature of one tile's RGBA bytes (FNV-1a, 32 bit, with the size), and
 * whether the tile is fully transparent.
 */
export function signature(data: Uint8ClampedArray | Uint8Array, w: number, h: number): { sig: string; empty: boolean } {
  let hash = 0x811c9dc5;
  let empty = true;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
    if (empty && (i & 3) === 3 && data[i] !== 0) empty = false;
  }
  return { sig: `${w}x${h}:${(hash >>> 0).toString(16)}`, empty };
}

interface TileCut {
  tx: number;
  ty: number;
  sig: string;
  empty: boolean;
}

function cut(canvas: HTMLCanvasElement): TileCut[] {
  const { cols, rows } = grid(canvas.width, canvas.height);
  const cx = ctx2d(canvas);
  const out: TileCut[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      const w = Math.min(TILE, canvas.width - x);
      const h = Math.min(TILE, canvas.height - y);
      if (w <= 0 || h <= 0) continue;
      const { sig, empty } = signature(cx.getImageData(x, y, w, h).data, w, h);
      out.push({ tx, ty, sig, empty });
    }
  }
  return out;
}

/** The PNG of one tile of `canvas`. */
async function tilePng(canvas: HTMLCanvasElement, tx: number, ty: number): Promise<ArrayBuffer> {
  const x = tx * TILE;
  const y = ty * TILE;
  const w = Math.min(TILE, canvas.width - x);
  const h = Math.min(TILE, canvas.height - y);
  const t = createCanvas(w, h);
  ctx2d(t).drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return canvasToPngBytes(t);
}

/**
 * The tile writes that take the node from what it holds (as far as this page
 * knows) to `canvas`: changed tiles to upload, emptied ones to remove. With
 * nothing known, every non-empty tile is written and every empty one removed.
 */
export function diffTiles(
  canvas: HTMLCanvasElement,
  previous: Map<string, string> | undefined,
): { upload: TileCut[]; remove: TileCut[]; next: Map<string, string> } {
  const upload: TileCut[] = [];
  const remove: TileCut[] = [];
  const next = new Map<string, string>();
  for (const t of cut(canvas)) {
    const key = `${t.tx},${t.ty}`;
    const before = previous?.get(key);
    if (t.empty) {
      if (!previous || before !== undefined) remove.push(t);
    } else {
      next.set(key, t.sig);
      if (before !== t.sig) upload.push(t);
    }
  }
  return { upload, remove, next };
}

/**
 * Writes `canvas` as `layer`'s pixels (or mask): uploads the changed tiles,
 * then one `updateLayerContent` / `updateLayerMask` with them. Answers how many
 * tiles were written.
 */
export async function commitTiles(
  deps: TileDeps,
  app: string,
  layer: string,
  plane: Plane,
  canvas: HTMLCanvasElement,
  updatedAt: number,
): Promise<number> {
  const k = planeKey(app, layer, plane);
  const { upload, remove, next } = diffTiles(canvas, known.get(k));
  const uploaded = await mapLimit(upload, UPLOADS, async (t) => {
    const { blobId } = await deps.uploadBlob(await tilePng(canvas, t.tx, t.ty), app);
    if (!blobId) throw new Error("tile upload failed");
    return { tx: t.tx, ty: t.ty, blobId } as TileWrite;
  });
  const writes: TileWrite[] = [...uploaded, ...remove.map((t) => ({ tx: t.tx, ty: t.ty, blobId: null }))];
  if (plane === "pixels") {
    await deps.pixart.updateLayerContent(app, layer, canvas.width, canvas.height, writes, updatedAt);
  } else {
    await deps.pixart.updateLayerMask(app, layer, writes, updatedAt);
  }
  known.set(k, next);
  return writes.length;
}

/** Removes `layer`'s mask on the node. */
export async function clearMask(deps: TileDeps, app: string, layer: string, updatedAt: number): Promise<void> {
  await deps.pixart.updateLayerMask(app, layer, null, updatedAt);
  known.delete(planeKey(app, layer, "mask"));
}

/**
 * Draws `layer`'s stored tiles onto `canvas` (cleared first) and remembers
 * what each tile holds, so the next commit writes only what changes. A tile
 * that fails to load is left blank and unknown, so the next commit rewrites it.
 */
export async function loadTiles(
  deps: TileDeps,
  app: string,
  layer: string,
  plane: Plane,
  canvas: HTMLCanvasElement,
  onTile: () => void = () => {},
): Promise<void> {
  const tiles = await deps.pixart.getLayerTiles(app, layer, plane === "mask");
  const cx = ctx2d(canvas);
  cx.clearRect(0, 0, canvas.width, canvas.height);
  const drawn = new Map<string, string>();
  await mapLimit(tiles, DOWNLOADS, async (t) => {
    try {
      const img = await bytesToImage(await deps.getBlob(t.blobId, app));
      const x = t.tx * TILE;
      const y = t.ty * TILE;
      cx.clearRect(x, y, TILE, TILE);
      cx.drawImage(img, x, y);
      const w = Math.min(TILE, canvas.width - x);
      const h = Math.min(TILE, canvas.height - y);
      if (w > 0 && h > 0) drawn.set(`${t.tx},${t.ty}`, signature(cx.getImageData(x, y, w, h).data, w, h).sig);
      onTile();
    } catch {
      /* left unknown: the next commit writes it */
    }
  });
  // Tiles the node did not list are empty there; a failed one is unknown, so
  // the map stays partial and the next commit rewrites exactly those.
  const failed = tiles.length - drawn.size;
  known.set(planeKey(app, layer, plane), failed > 0 ? withUnknown(drawn, tiles) : drawn);
}

/** `drawn`, with a tile that failed to load marked so the next commit rewrites it. */
function withUnknown(drawn: Map<string, string>, tiles: { tx: number; ty: number }[]): Map<string, string> {
  const out = new Map(drawn);
  for (const t of tiles) {
    const key = `${t.tx},${t.ty}`;
    if (!out.has(key)) out.set(key, "unknown");
  }
  return out;
}
