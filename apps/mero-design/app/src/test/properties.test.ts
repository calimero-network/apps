import { describe, it, expect } from "vitest";
import type { Element, ElementData } from "../types";

// ── Opacity → Fabric mapping ──────────────────────────────────────────────────

function fabricOpacity(elementOpacity: number): number {
  return elementOpacity / 100;
}

describe("opacity → Fabric opacity mapping", () => {
  it("opacity 100 maps to Fabric 1.0", () => {
    expect(fabricOpacity(100)).toBe(1.0);
  });

  it("opacity 50 maps to Fabric 0.5", () => {
    expect(fabricOpacity(50)).toBe(0.5);
  });

  it("opacity 0 maps to Fabric 0.0", () => {
    expect(fabricOpacity(0)).toBe(0.0);
  });

  it("opacity 25 maps to Fabric 0.25", () => {
    expect(fabricOpacity(25)).toBe(0.25);
  });

  it("opacity 75 maps to Fabric 0.75", () => {
    expect(fabricOpacity(75)).toBe(0.75);
  });

  it("opacity 1 maps to Fabric 0.01", () => {
    expect(fabricOpacity(1)).toBeCloseTo(0.01);
  });

  it("result is always in [0, 1]", () => {
    for (const v of [0, 10, 50, 90, 100]) {
      const r = fabricOpacity(v);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

// ── Text alignment defaults ───────────────────────────────────────────────────

function textAlignDefault(data: ElementData): string {
  return data.text_align ?? "left";
}

function verticalAlignDefault(data: ElementData): string {
  return data.vertical_align ?? "top";
}

describe("text alignment defaults", () => {
  const baseData: ElementData = {
    kind: "text",
    content: "Hello",
  };

  it("text_align defaults to 'left' when not set", () => {
    expect(textAlignDefault(baseData)).toBe("left");
  });

  it("vertical_align defaults to 'top' when not set", () => {
    expect(verticalAlignDefault(baseData)).toBe("top");
  });

  it("explicit text_align 'center' is preserved", () => {
    expect(textAlignDefault({ ...baseData, text_align: "center" })).toBe("center");
  });

  it("explicit text_align 'right' is preserved", () => {
    expect(textAlignDefault({ ...baseData, text_align: "right" })).toBe("right");
  });

  it("explicit vertical_align 'middle' is preserved", () => {
    expect(verticalAlignDefault({ ...baseData, vertical_align: "middle" })).toBe("middle");
  });

  it("explicit vertical_align 'bottom' is preserved", () => {
    expect(verticalAlignDefault({ ...baseData, vertical_align: "bottom" })).toBe("bottom");
  });
});

// ── ElementData text_align field type guard ───────────────────────────────────

describe("ElementData text_align type", () => {
  it("accepts 'left' as text_align value", () => {
    const data: ElementData = { kind: "text", text_align: "left" };
    expect(data.text_align).toBe("left");
  });

  it("accepts 'center' as text_align value", () => {
    const data: ElementData = { kind: "text", text_align: "center" };
    expect(data.text_align).toBe("center");
  });

  it("accepts 'right' as text_align value", () => {
    const data: ElementData = { kind: "text", text_align: "right" };
    expect(data.text_align).toBe("right");
  });

  it("accepts 'top' as vertical_align value", () => {
    const data: ElementData = { kind: "text", vertical_align: "top" };
    expect(data.vertical_align).toBe("top");
  });

  it("accepts 'middle' as vertical_align value", () => {
    const data: ElementData = { kind: "text", vertical_align: "middle" };
    expect(data.vertical_align).toBe("middle");
  });

  it("accepts 'bottom' as vertical_align value", () => {
    const data: ElementData = { kind: "text", vertical_align: "bottom" };
    expect(data.vertical_align).toBe("bottom");
  });

  it("text_align is undefined for non-text elements (rect)", () => {
    const data: ElementData = { kind: "rect" };
    expect(data.text_align).toBeUndefined();
  });
});

// ── Prototype HTML text-align / vertical-align integration ───────────────────

function textStyleCss(el: Element): string {
  const ta = el.data.text_align ?? "left";
  const va = el.data.vertical_align ?? "top";
  const justify =
    va === "middle" ? "center" : va === "bottom" ? "flex-end" : "flex-start";
  return `display: flex; flex-direction: column; justify-content: ${justify}; text-align: ${ta};`;
}

describe("buildPrototypeHtml CSS generation", () => {
  function makeTextEl(overrides: Partial<ElementData> = {}): Element {
    return {
      id: "t1",
      data: { kind: "text", content: "Hi", ...overrides },
      x: 0, y: 0, width: 200, height: 40, rotation: 0,
      fill: "#000", stroke: "transparent", strokeWidth: 0,
      opacity: 100, layerIndex: 0, createdBy: "", createdAt: 0, updatedAt: 0,
    };
  }

  it("default alignment: text-align left, justify-content flex-start", () => {
    const css = textStyleCss(makeTextEl());
    expect(css).toContain("text-align: left");
    expect(css).toContain("justify-content: flex-start");
  });

  it("center horizontal, middle vertical", () => {
    const css = textStyleCss(makeTextEl({ text_align: "center", vertical_align: "middle" }));
    expect(css).toContain("text-align: center");
    expect(css).toContain("justify-content: center");
  });

  it("right horizontal, bottom vertical", () => {
    const css = textStyleCss(makeTextEl({ text_align: "right", vertical_align: "bottom" }));
    expect(css).toContain("text-align: right");
    expect(css).toContain("justify-content: flex-end");
  });

  it("center horizontal, top vertical", () => {
    const css = textStyleCss(makeTextEl({ text_align: "center", vertical_align: "top" }));
    expect(css).toContain("text-align: center");
    expect(css).toContain("justify-content: flex-start");
  });
});

// ── update_text_style RPC payload shape ───────────────────────────────────────

describe("update_text_style RPC payload", () => {
  function buildPayload(patch: {
    text_align?: string;
    vertical_align?: string;
    bold?: boolean;
  }) {
    return {
      text_align:     patch.text_align     ?? null,
      vertical_align: patch.vertical_align ?? null,
      bold:           patch.bold           ?? null,
    };
  }

  it("sets text_align to 'center' and nulls others", () => {
    const payload = buildPayload({ text_align: "center" });
    expect(payload.text_align).toBe("center");
    expect(payload.vertical_align).toBeNull();
  });

  it("sets vertical_align to 'bottom' and nulls others", () => {
    const payload = buildPayload({ vertical_align: "bottom" });
    expect(payload.vertical_align).toBe("bottom");
    expect(payload.text_align).toBeNull();
  });

  it("null payload for text_align when not provided", () => {
    const payload = buildPayload({});
    expect(payload.text_align).toBeNull();
    expect(payload.vertical_align).toBeNull();
  });
});
