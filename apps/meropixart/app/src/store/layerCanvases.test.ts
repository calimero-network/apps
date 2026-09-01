import { describe, it, expect, beforeEach } from "vitest";
import {
  clearAllCanvases, dropLayerCanvas, dropMaskCanvas, getLayerCanvas, getMaskCanvas,
  layerPixelVersion, maskPixelVersion, peekLayerCanvas, peekMaskCanvas,
  setLayerCanvas, setMaskCanvas, snapshotLayerCanvas,
} from "./layerCanvases";
import { createCanvas } from "../utils/raster";

// The version counters are what make the compositor's prepared-layer cache safe.
// The rule — `get*` means write intent and bumps, `peek*` is a pure read — is only
// true if every mutation path really does go through a `get*`, so these tests pin
// the rule itself.

beforeEach(() => clearAllCanvases());

describe("layer canvas registry", () => {
  it("creates a canvas at the requested size, once", () => {
    const a = getLayerCanvas("l", 40, 20);
    expect([a.width, a.height]).toEqual([40, 20]);
    expect(getLayerCanvas("l", 40, 20)).toBe(a);
  });

  it("resizes while keeping the pixels, anchored top-left", () => {
    const a = getLayerCanvas("l", 10, 10);
    const b = getLayerCanvas("l", 30, 30);
    expect(b).not.toBe(a);
    expect([b.width, b.height]).toEqual([30, 30]);
  });

  it("peek returns undefined for an unknown layer and never creates one", () => {
    expect(peekLayerCanvas("ghost")).toBeUndefined();
    expect(peekMaskCanvas("ghost")).toBeUndefined();
  });

  it("drops a canvas", () => {
    getLayerCanvas("l", 10, 10);
    dropLayerCanvas("l");
    expect(peekLayerCanvas("l")).toBeUndefined();
  });

  it("snapshots to a data URL, or null when there is nothing", () => {
    expect(snapshotLayerCanvas("l")).toBeNull();
    getLayerCanvas("l", 4, 4);
    expect(snapshotLayerCanvas("l")).toMatch(/^data:image\/png/);
  });

  it("keeps masks in their own registry, white by default", () => {
    const mask = getMaskCanvas("l", 8, 8);
    expect(peekMaskCanvas("l")).toBe(mask);
    expect(peekLayerCanvas("l")).toBeUndefined();
    dropMaskCanvas("l");
    expect(peekMaskCanvas("l")).toBeUndefined();
  });
});

describe("pixel versions", () => {
  it("start at zero for an unknown layer", () => {
    expect(layerPixelVersion("nobody")).toBe(0);
    expect(maskPixelVersion("nobody")).toBe(0);
  });

  it("bump on getLayerCanvas — the call every mutation path makes", () => {
    const before = layerPixelVersion("l");
    getLayerCanvas("l", 10, 10);
    expect(layerPixelVersion("l")).toBeGreaterThan(before);
    // and again: a brush dab calls it per dab
    const mid = layerPixelVersion("l");
    getLayerCanvas("l", 10, 10);
    expect(layerPixelVersion("l")).toBeGreaterThan(mid);
  });

  it("do NOT bump on peek — otherwise the cache could never hit", () => {
    getLayerCanvas("l", 10, 10);
    const before = layerPixelVersion("l");
    peekLayerCanvas("l");
    peekLayerCanvas("l");
    expect(layerPixelVersion("l")).toBe(before);
  });

  it("bump on set and on drop", () => {
    const before = layerPixelVersion("l");
    setLayerCanvas("l", createCanvas(4, 4));
    const afterSet = layerPixelVersion("l");
    expect(afterSet).toBeGreaterThan(before);
    dropLayerCanvas("l");
    expect(layerPixelVersion("l")).toBeGreaterThan(afterSet);
  });

  it("track masks separately from pixels", () => {
    // Relative, not absolute: `clearAllCanvases` bumps rather than resets, so a
    // fresh test does not start from zero for an id an earlier test touched.
    const pixelsBefore = layerPixelVersion("l");
    getMaskCanvas("l", 8, 8);
    expect(maskPixelVersion("l")).toBeGreaterThan(0);
    expect(layerPixelVersion("l")).toBe(pixelsBefore);

    const maskBefore = maskPixelVersion("l");
    getLayerCanvas("l", 8, 8);
    expect(maskPixelVersion("l")).toBe(maskBefore);
  });

  it("bump on setMaskCanvas and dropMaskCanvas", () => {
    const before = maskPixelVersion("l");
    setMaskCanvas("l", createCanvas(4, 4));
    const afterSet = maskPixelVersion("l");
    expect(afterSet).toBeGreaterThan(before);
    dropMaskCanvas("l");
    expect(maskPixelVersion("l")).toBeGreaterThan(afterSet);
  });

  it("are per layer", () => {
    const bBefore = layerPixelVersion("b");
    getLayerCanvas("a", 4, 4);
    expect(layerPixelVersion("a")).toBeGreaterThan(0);
    expect(layerPixelVersion("b")).toBe(bBefore);
  });

  it("keep counting across clearAllCanvases, never reset", () => {
    // A new document can reuse an id (the showcase loader's deterministic ids in
    // tests do). A reset counter could collide with a signature cached from the
    // document just closed, and the canvas would show the old pixels.
    getLayerCanvas("l", 4, 4);
    getMaskCanvas("l", 4, 4);
    const pixels = layerPixelVersion("l");
    const mask = maskPixelVersion("l");

    clearAllCanvases();

    expect(peekLayerCanvas("l")).toBeUndefined();
    expect(layerPixelVersion("l")).toBeGreaterThan(pixels);
    expect(maskPixelVersion("l")).toBeGreaterThan(mask);
  });
});
