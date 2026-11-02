import { beforeEach, describe, expect, it, vi } from "vitest";

// PNG encoding and decoding are the browser's; here a tile's "PNG" is its
// position, and decoding draws nothing (the stub canvas keeps raw pixels).
vi.mock("../utils/raster", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canvasToPngBytes: vi.fn(async () => new ArrayBuffer(4)),
  bytesToImage: vi.fn(async () => document.createElement("canvas")),
}));

const { TILE, commitTiles, diffTiles, forgetAllTiles, grid, loadTiles, signature } = await import("./tiles");
const { createCanvas, ctx2d } = await import("../utils/raster");

/** Paints one opaque pixel at (x, y). */
function dab(c: HTMLCanvasElement, x: number, y: number, v = 200) {
  const img = ctx2d(c).createImageData(1, 1);
  img.data.set([v, 0, 0, 255]);
  ctx2d(c).putImageData(img, x, y);
}

function deps() {
  let n = 0;
  return {
    pixart: {
      updateLayerContent: vi.fn(async () => {}),
      updateLayerMask: vi.fn(async () => {}),
      getLayerTiles: vi.fn(async () => [] as { tx: number; ty: number; blobId: string }[]),
    },
    uploadBlob: vi.fn(async () => ({ blobId: `blob-${++n}` })),
    getBlob: vi.fn(async () => new ArrayBuffer(4)),
  };
}

beforeEach(() => forgetAllTiles());

describe("the tile grid", () => {
  it("covers a raster with 256-pixel tiles", () => {
    expect(TILE).toBe(256);
    expect(grid(600, 300)).toEqual({ cols: 3, rows: 2 });
    expect(grid(256, 256)).toEqual({ cols: 1, rows: 1 });
  });

  it("tells an empty tile from a painted one, and two different tiles apart", () => {
    const empty = signature(new Uint8ClampedArray(16), 2, 2);
    expect(empty.empty).toBe(true);
    const a = signature(Uint8ClampedArray.from([1, 2, 3, 255]), 1, 1);
    const b = signature(Uint8ClampedArray.from([1, 2, 4, 255]), 1, 1);
    expect(a.empty).toBe(false);
    expect(a.sig).not.toBe(b.sig);
  });
});

describe("a commit writes only what changed", () => {
  it("writes every painted tile and removes every empty one the first time", () => {
    const c = createCanvas(600, 300);
    dab(c, 10, 10);
    dab(c, 590, 290);
    const { upload, remove } = diffTiles(c, undefined);
    expect(upload.map((t) => [t.tx, t.ty])).toEqual([[0, 0], [2, 1]]);
    expect(remove).toHaveLength(4);
  });

  it("uploads one tile for a stroke in one corner, and nothing for no change", async () => {
    const d = deps();
    const c = createCanvas(600, 300);
    dab(c, 10, 10);
    await commitTiles(d, "app", "l1", "pixels", c, 1);
    expect(d.uploadBlob).toHaveBeenCalledTimes(1);

    dab(c, 300, 20); // tile (1, 0)
    await commitTiles(d, "app", "l1", "pixels", c, 2);
    expect(d.uploadBlob).toHaveBeenCalledTimes(2);
    expect(d.pixart.updateLayerContent).toHaveBeenLastCalledWith("app", "l1", 600, 300, [{ tx: 1, ty: 0, blobId: "blob-2" }], 2);

    await commitTiles(d, "app", "l1", "pixels", c, 3);
    expect(d.uploadBlob).toHaveBeenCalledTimes(2);
    expect(d.pixart.updateLayerContent).toHaveBeenLastCalledWith("app", "l1", 600, 300, [], 3);
  });

  it("removes a tile that was erased", async () => {
    const d = deps();
    const c = createCanvas(300, 300);
    dab(c, 10, 10);
    await commitTiles(d, "app", "l1", "pixels", c, 1);
    // The eraser: the pixel goes back to fully transparent.
    const img = ctx2d(c).createImageData(1, 1);
    ctx2d(c).putImageData(img, 10, 10);
    await commitTiles(d, "app", "l1", "pixels", c, 2);
    expect(d.pixart.updateLayerContent).toHaveBeenLastCalledWith("app", "l1", 300, 300, [{ tx: 0, ty: 0, blobId: null }], 2);
  });

  it("writes a mask through updateLayerMask", async () => {
    const d = deps();
    const c = createCanvas(100, 100);
    dab(c, 1, 1);
    await commitTiles(d, "app", "l1", "mask", c, 4);
    expect(d.pixart.updateLayerMask).toHaveBeenCalledWith("app", "l1", [{ tx: 0, ty: 0, blobId: "blob-1" }], 4);
    expect(d.pixart.updateLayerContent).not.toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("draws every listed tile and remembers it, so an unchanged commit writes nothing", async () => {
    const d = deps();
    d.pixart.getLayerTiles.mockResolvedValue([{ tx: 1, ty: 0, blobId: "b1" }]);
    const c = createCanvas(600, 300);
    const onTile = vi.fn();
    await loadTiles(d, "app", "l1", "pixels", c, onTile);
    expect(d.getBlob).toHaveBeenCalledWith("b1", "app");
    expect(onTile).toHaveBeenCalledTimes(1);
    await commitTiles(d, "app", "l1", "pixels", c, 2);
    expect(d.uploadBlob).not.toHaveBeenCalled();
  });

  it("rewrites a tile that failed to load at the next commit", async () => {
    const d = deps();
    d.pixart.getLayerTiles.mockResolvedValue([{ tx: 0, ty: 0, blobId: "gone" }]);
    d.getBlob.mockRejectedValue(new Error("404"));
    const c = createCanvas(100, 100);
    await loadTiles(d, "app", "l1", "pixels", c);
    await commitTiles(d, "app", "l1", "pixels", c, 2);
    expect(d.pixart.updateLayerContent).toHaveBeenLastCalledWith("app", "l1", 100, 100, [{ tx: 0, ty: 0, blobId: null }], 2);
  });
});
