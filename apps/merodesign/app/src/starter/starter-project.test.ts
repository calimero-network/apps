import { describe, it, expect } from "vitest";
import raw from "./starter-project.json?raw";
import { validateSnapshot } from "../utils/projectFile";
import type { Element } from "../types";

/**
 * Guards the asset the "Open starter project" menu item ships. A malformed or
 * regenerated-but-not-committed starter would clear a board and leave nothing
 * behind, so every property the loader and the e2e specs rely on is asserted here.
 */
const snapshot = JSON.parse(raw) as { elements: Element[]; comments: unknown[]; boardName: string };

describe("the bundled starter project", () => {
  it("passes the same validator the import path uses", () => {
    expect(validateSnapshot(snapshot)).toBe(true);
  });

  it("has five screens laid out on a 1580px pitch", () => {
    const screens = snapshot.elements.filter((e) => (e.label ?? "").startsWith("screen/"));
    expect(screens).toHaveLength(5);
    expect(screens.map((s) => s.x)).toEqual([0, 1580, 3160, 4740, 6320]);
    for (const s of screens) expect({ w: s.width, h: s.height }).toEqual({ w: 1440, h: 900 });
  });

  it("uses only kinds the renderer supports", () => {
    const kinds = new Set(snapshot.elements.map((e) => e.data.kind));
    expect([...kinds].sort()).toEqual(["circle", "rect", "text"]);
  });

  it("spans three font families and a real type scale", () => {
    const texts = snapshot.elements.filter((e) => e.data.kind === "text");
    expect(new Set(texts.map((t) => t.data.fontFamily)).size).toBe(3);
    const sizes = [...new Set(texts.map((t) => t.data.fontSize))].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(sizes.length).toBeGreaterThanOrEqual(10);
    expect(sizes[0]).toBeLessThanOrEqual(11);
    expect(sizes[sizes.length - 1]).toBeGreaterThanOrEqual(40);
  });

  it("ships the full button matrix: four variants in three sizes", () => {
    const labels = snapshot.elements.map((e) => e.label ?? "");
    for (const variant of ["primary", "secondary", "ghost", "danger"]) {
      for (const size of ["sm", "md", "lg"]) {
        expect(labels).toContain(`btn/${variant}-${size}`);
      }
    }
  });

  it("has unique ids and a unique layer per element", () => {
    const ids = snapshot.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const layers = snapshot.elements.map((e) => e.layerIndex);
    expect(new Set(layers).size).toBe(layers.length);
  });

  it("claims no author — the contract stores createdBy verbatim", () => {
    expect(snapshot.elements.every((e) => e.createdBy === "")).toBe(true);
  });

  it("is big enough to be a real design", () => {
    expect(snapshot.elements.length).toBeGreaterThan(400);
    expect(snapshot.comments.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.boardName).toContain("Northwind");
  });
});
