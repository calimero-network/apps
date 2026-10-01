import { beforeEach, describe, expect, it } from "vitest";
import type { Element } from "../types";
import {
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  buildBoardPreviewSvg,
  clearPreviewMemory,
  createLimiter,
  previewBounds,
  readCachedPreview,
  writeCachedPreview,
} from "./boardPreview";

function el(over: Partial<Element> = {}): Element {
  return {
    id: "e1",
    data: { kind: "rect" },
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, fill: "#ff0000", stroke: "transparent", strokeWidth: 0, opacity: 100,
    layerIndex: 0, createdBy: "", createdAt: 0, updatedAt: 0,
    ...over,
  };
}

describe("buildBoardPreviewSvg", () => {
  it("an empty board has no preview — the card is plain white", () => {
    expect(buildBoardPreviewSvg([], 2)).toBeNull();
  });

  it("draws the board's shapes on a white background", () => {
    const svg = buildBoardPreviewSvg([el(), el({ id: "e2", data: { kind: "circle" }, x: 200, fill: "#00ff00" })], 2)!;
    expect(svg).toContain("<svg");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("#ff0000");
    expect(svg).toContain("#00ff00");
  });

  it("never fetches or embeds a bitmap: an image is a grey placeholder box", () => {
    const svg = buildBoardPreviewSvg(
      [el({ id: "img", data: { kind: "image", blobId: "abc", naturalWidth: 10, naturalHeight: 10 } })],
      2,
    )!;
    expect(svg).not.toContain("<image");
    expect(svg).toContain('fill="#e8e8e8"');
  });

  it("escapes text so a label can never become markup", () => {
    const svg = buildBoardPreviewSvg(
      [el({ data: { kind: "text", content: "<script>x</script>", fontSize: 12, fontFamily: "sans-serif", bold: false, italic: false } })],
      2,
    )!;
    expect(svg).not.toContain("<script>");
  });
});

describe("previewBounds", () => {
  it("matches the card's aspect ratio and contains the content", () => {
    const b = previewBounds([el({ x: 100, y: 100, width: 400, height: 400 })], 240 / 110);
    expect(b.width / b.height).toBeCloseTo(240 / 110, 1);
    expect(b.x).toBeLessThanOrEqual(100);
    expect(b.y).toBeLessThanOrEqual(100);
    expect(b.x + b.width).toBeGreaterThanOrEqual(500);
    expect(b.y + b.height).toBeGreaterThanOrEqual(500);
  });

  it("centres the content", () => {
    const b = previewBounds([el({ x: 0, y: 0, width: 100, height: 100 })], 3);
    expect(b.x + b.width / 2).toBeCloseTo(50, 0);
    expect(b.y + b.height / 2).toBeCloseTo(50, 0);
  });
});

describe("preview cache", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPreviewMemory();
  });

  it("an unseen project is undefined, an empty board is the empty string", () => {
    expect(readCachedPreview("ctx")).toBeUndefined();
    writeCachedPreview("ctx", "");
    clearPreviewMemory();
    expect(readCachedPreview("ctx")).toBe("");
  });

  it("survives a reload through localStorage", () => {
    writeCachedPreview("ctx", "<svg/>");
    clearPreviewMemory();
    expect(readCachedPreview("ctx")).toBe("<svg/>");
  });

  it("keeps only the most recently used projects", () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) writeCachedPreview(`c${i}`, `<svg id="${i}"/>`);
    clearPreviewMemory();
    expect(readCachedPreview("c0")).toBeUndefined();
    expect(readCachedPreview(`c${MAX_ENTRIES + 4}`)).toBe(`<svg id="${MAX_ENTRIES + 4}"/>`);
    const stored = Object.keys(localStorage).filter((k) => k.startsWith("md-board-preview:"));
    expect(stored).toHaveLength(MAX_ENTRIES);
  });

  it("a preview over the size cap stays in memory only, and replaces an older stored copy", () => {
    writeCachedPreview("big", "<svg/>");
    const huge = "x".repeat(MAX_ENTRY_CHARS + 1);
    writeCachedPreview("big", huge);
    expect(readCachedPreview("big")).toBe(huge);
    clearPreviewMemory();
    expect(readCachedPreview("big")).toBeUndefined();
  });
});

describe("createLimiter", () => {
  it("never runs more than the limit at once, and runs everything", async () => {
    const schedule = createLimiter(3);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, i) =>
      schedule(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        done.push(i);
        return i;
      }),
    );
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(done).toHaveLength(10);
  });

  it("a failing task frees its slot", async () => {
    const schedule = createLimiter(1);
    await expect(schedule(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await expect(schedule(async () => 7)).resolves.toBe(7);
  });
});
