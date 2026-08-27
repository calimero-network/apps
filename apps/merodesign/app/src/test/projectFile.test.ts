import { describe, it, expect } from "vitest";
import { validateSnapshot, type ProjectSnapshot } from "../utils/projectFile";
import type { Element } from "../types";

const RECT_EL: Element = {
  id: "el-1",
  data: { kind: "rect" },
  x: 10, y: 20, width: 100, height: 80,
  rotation: 0, fill: "#ff0000", stroke: "transparent", strokeWidth: 0,
  opacity: 100, layerIndex: 0, createdBy: "test", createdAt: 1000, updatedAt: 2000,
};

const VALID_SNAP: ProjectSnapshot = {
  version: 1,
  exportedAt: 12345,
  boardName: "Test Board",
  boardDescription: "A test",
  elements: [],
  comments: [],
};

// ── validateSnapshot ──────────────────────────────────────────────────────────

describe("validateSnapshot", () => {
  it("accepts a minimal valid snapshot", () => {
    expect(validateSnapshot(VALID_SNAP)).toBe(true);
  });

  it("accepts snapshot with elements and comments", () => {
    const snap = { ...VALID_SNAP, elements: [RECT_EL], comments: [] };
    expect(validateSnapshot(snap)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateSnapshot(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateSnapshot(undefined)).toBe(false);
  });

  it("rejects a string", () => {
    expect(validateSnapshot('{"version":1}')).toBe(false);
  });

  it("rejects a number", () => {
    expect(validateSnapshot(42)).toBe(false);
  });

  it("rejects empty object", () => {
    expect(validateSnapshot({})).toBe(false);
  });

  it("rejects version 0", () => {
    expect(validateSnapshot({ ...VALID_SNAP, version: 0 })).toBe(false);
  });

  it("rejects version 2", () => {
    expect(validateSnapshot({ ...VALID_SNAP, version: 2 })).toBe(false);
  });

  it("rejects string version", () => {
    expect(validateSnapshot({ ...VALID_SNAP, version: "1" })).toBe(false);
  });

  it("rejects missing elements", () => {
    const { elements: _, ...rest } = VALID_SNAP;
    expect(validateSnapshot(rest)).toBe(false);
  });

  it("rejects missing comments", () => {
    const { comments: _, ...rest } = VALID_SNAP;
    expect(validateSnapshot(rest)).toBe(false);
  });

  it("rejects elements as object (not array)", () => {
    expect(validateSnapshot({ ...VALID_SNAP, elements: {} })).toBe(false);
  });

  it("rejects elements as string", () => {
    expect(validateSnapshot({ ...VALID_SNAP, elements: "[]" })).toBe(false);
  });

  it("rejects comments as object", () => {
    expect(validateSnapshot({ ...VALID_SNAP, comments: {} })).toBe(false);
  });

  it("rejects comments as null", () => {
    expect(validateSnapshot({ ...VALID_SNAP, comments: null })).toBe(false);
  });

  it("boardName is optional — missing boardName still passes", () => {
    const { boardName: _, ...rest } = VALID_SNAP;
    expect(validateSnapshot(rest)).toBe(true);
  });

  it("boardDescription is optional — missing still passes", () => {
    const { boardDescription: _, ...rest } = VALID_SNAP;
    expect(validateSnapshot(rest)).toBe(true);
  });

  it("exportedAt is optional — missing still passes", () => {
    const { exportedAt: _, ...rest } = VALID_SNAP;
    expect(validateSnapshot(rest)).toBe(true);
  });
});

// ── Round-trip serialization ──────────────────────────────────────────────────

describe("snapshot round-trip", () => {
  it("JSON stringify/parse preserves structure", () => {
    const snap: ProjectSnapshot = {
      ...VALID_SNAP,
      elements: [RECT_EL],
      comments: [
        {
          id: "c1", x: 50, y: 60, content: "Hello", author: "alice",
          createdAt: 3000,
          replies: [{ id: "r1", content: "Hi back", author: "bob", createdAt: 3001 }],
        },
      ],
    };
    const parsed = JSON.parse(JSON.stringify(snap)) as unknown;
    expect(validateSnapshot(parsed)).toBe(true);
    const p = parsed as ProjectSnapshot;
    expect(p.version).toBe(1);
    expect(p.elements).toHaveLength(1);
    expect(p.elements[0].id).toBe("el-1");
    expect(p.elements[0].data.kind).toBe("rect");
    expect(p.comments).toHaveLength(1);
    expect(p.comments[0].content).toBe("Hello");
    expect(p.comments[0].replies).toHaveLength(1);
    expect(p.comments[0].replies[0].content).toBe("Hi back");
  });

  it("preserves element opacity and position", () => {
    const el = { ...RECT_EL, opacity: 75, x: 123, y: 456 };
    const snap = { ...VALID_SNAP, elements: [el] };
    const p = JSON.parse(JSON.stringify(snap)) as ProjectSnapshot;
    expect(p.elements[0].opacity).toBe(75);
    expect(p.elements[0].x).toBe(123);
    expect(p.elements[0].y).toBe(456);
  });

  it("preserves text element with text_align and vertical_align", () => {
    const textEl: Element = {
      id: "t1",
      data: {
        kind: "text",
        content: "Hello",
        text_align: "center",
        vertical_align: "middle",
      },
      x: 0, y: 0, width: 200, height: 40, rotation: 0,
      fill: "#000", stroke: "transparent", strokeWidth: 0,
      opacity: 100, layerIndex: 0, createdBy: "", createdAt: 0, updatedAt: 0,
    };
    const snap = { ...VALID_SNAP, elements: [textEl] };
    const p = JSON.parse(JSON.stringify(snap)) as ProjectSnapshot;
    expect(p.elements[0].data.text_align).toBe("center");
    expect(p.elements[0].data.vertical_align).toBe("middle");
  });

  it("preserves text element bold/italic", () => {
    const textEl: Element = {
      id: "t2",
      data: { kind: "text", content: "Bold", bold: true, italic: false },
      x: 0, y: 0, width: 100, height: 30, rotation: 0,
      fill: "#111", stroke: "transparent", strokeWidth: 0,
      opacity: 100, layerIndex: 0, createdBy: "", createdAt: 0, updatedAt: 0,
    };
    const p = JSON.parse(JSON.stringify({ ...VALID_SNAP, elements: [textEl] })) as ProjectSnapshot;
    expect(p.elements[0].data.bold).toBe(true);
    expect(p.elements[0].data.italic).toBe(false);
  });

  it("preserves boardName in round-trip", () => {
    const snap = { ...VALID_SNAP, boardName: "My Awesome Board" };
    const p = JSON.parse(JSON.stringify(snap)) as ProjectSnapshot;
    expect(p.boardName).toBe("My Awesome Board");
  });

  it("preserves exportedAt timestamp", () => {
    const ts = 1748476800000;
    const snap = { ...VALID_SNAP, exportedAt: ts };
    const p = JSON.parse(JSON.stringify(snap)) as ProjectSnapshot;
    expect(p.exportedAt).toBe(ts);
  });

  it("handles snapshot with zero elements and zero comments", () => {
    const snap = { ...VALID_SNAP, elements: [], comments: [] };
    const p = JSON.parse(JSON.stringify(snap)) as ProjectSnapshot;
    expect(validateSnapshot(p)).toBe(true);
    expect(p.elements).toHaveLength(0);
    expect(p.comments).toHaveLength(0);
  });

  it("element fill and stroke preserved", () => {
    const el = { ...RECT_EL, fill: "#abcdef", stroke: "#123456" };
    const p = JSON.parse(JSON.stringify({ ...VALID_SNAP, elements: [el] })) as ProjectSnapshot;
    expect(p.elements[0].fill).toBe("#abcdef");
    expect(p.elements[0].stroke).toBe("#123456");
  });

  it("element with all shadow fields preserved", () => {
    const el: Element = {
      ...RECT_EL,
      shadowColor: "rgba(0,0,0,0.3)",
      shadowOffsetX: 2,
      shadowOffsetY: 4,
      shadowBlur: 8,
    };
    const p = JSON.parse(JSON.stringify({ ...VALID_SNAP, elements: [el] })) as ProjectSnapshot;
    expect(p.elements[0].shadowColor).toBe("rgba(0,0,0,0.3)");
    expect(p.elements[0].shadowBlur).toBe(8);
  });

  it("multiple elements preserve layerIndex order", () => {
    const els: Element[] = [
      { ...RECT_EL, id: "e1", layerIndex: 2 },
      { ...RECT_EL, id: "e2", layerIndex: 0 },
      { ...RECT_EL, id: "e3", layerIndex: 1 },
    ];
    const p = JSON.parse(JSON.stringify({ ...VALID_SNAP, elements: els })) as ProjectSnapshot;
    expect(p.elements.map((e) => e.layerIndex)).toEqual([2, 0, 1]);
  });
});
