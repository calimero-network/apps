import { describe, it, expect } from "vitest";
import type { Element } from "../types";
import { boundsOf, elementsToSvg, elementToSvgNode } from "./svgExport";

function el(over: Partial<Element> & { id: string }): Element {
  return {
    data: { kind: "rect" },
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, fill: "#4F8EF7", stroke: "transparent", strokeWidth: 0, opacity: 100,
    layerIndex: 0, createdBy: "", createdAt: 0, updatedAt: 0,
    ...over,
  } as Element;
}

describe("boundsOf", () => {
  it("covers every element", () => {
    expect(boundsOf([el({ id: "a", x: 10, y: 20 }), el({ id: "b", x: 200, y: 0, width: 10, height: 10 })]))
      .toEqual({ x: 10, y: 0, width: 200, height: 70 });
  });

  it("includes the half of a stroke that sits outside the shape", () => {
    const box = boundsOf([el({ id: "a", x: 0, y: 0, width: 10, height: 10, stroke: "#000", strokeWidth: 8 })]);
    expect(box).toEqual({ x: -4, y: -4, width: 18, height: 18 });
  });

  it("grows for a rotated element", () => {
    const box = boundsOf([el({ id: "a", x: 0, y: 0, width: 100, height: 0, rotation: 45 })]);
    expect(box.width).toBe(71);
    expect(box.height).toBe(71);
  });

  it("pads when asked", () => {
    expect(boundsOf([el({ id: "a", x: 0, y: 0, width: 10, height: 10 })], 5))
      .toEqual({ x: -5, y: -5, width: 20, height: 20 });
  });
});

describe("elementToSvgNode", () => {
  it("emits a rect with its corner radius", () => {
    const svg = elementToSvgNode(el({ id: "a", cornerRadius: 8 }));
    expect(svg).toContain('<rect ');
    expect(svg).toContain('rx="8"');
  });

  it("clamps a corner radius that would invert the shape", () => {
    expect(elementToSvgNode(el({ id: "a", width: 20, height: 20, cornerRadius: 999 }))).toContain('rx="10"');
  });

  it("anchors a circle by its top-left, like the canvas", () => {
    const svg = elementToSvgNode(el({ id: "a", data: { kind: "circle" }, x: 10, y: 20, width: 40, height: 40 }));
    expect(svg).toContain('cx="30"');
    expect(svg).toContain('cy="40"');
    expect(svg).toContain('r="20"');
  });

  it("rotates about the element's own top-left", () => {
    expect(elementToSvgNode(el({ id: "a", x: 5, y: 7, rotation: 30 }))).toContain('transform="rotate(30 5 7)"');
  });

  it("keeps a line's drawn direction", () => {
    const svg = elementToSvgNode(el({
      id: "a", data: { kind: "line", points: "0,50 100,0" },
      x: 10, y: 10, width: 100, height: 50, stroke: "#ff0000", strokeWidth: 3,
    }));
    expect(svg).toContain('x1="10" y1="60" x2="110" y2="10"');
    expect(svg).toContain('stroke="#ff0000"');
  });

  it("gives an arrow a head", () => {
    const svg = elementToSvgNode(el({ id: "a", data: { kind: "arrow", points: "0,0 50,0" }, stroke: "#000", strokeWidth: 2 }));
    expect(svg).toContain("<line ");
    expect(svg).toContain("<polygon ");
  });

  it("writes text as tspans, one per line", () => {
    const svg = elementToSvgNode(el({
      id: "a", data: { kind: "text", content: "one\ntwo", fontSize: 20, fontFamily: "Georgia", bold: true },
      fill: "#123456",
    }));
    expect(svg.match(/<tspan /g)).toHaveLength(2);
    expect(svg).toContain('font-family="Georgia"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('fill="#123456"');
  });

  it("escapes text content instead of injecting markup", () => {
    const svg = elementToSvgNode(el({ id: "a", data: { kind: "text", content: '</text><script>x</script>' } }));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("embeds image bytes and never links a blob URL", () => {
    const image = el({ id: "img", data: { kind: "image", blobId: "b1" } });
    const embedded = elementToSvgNode(image, { imageData: { img: "data:image/png;base64,AAA" } });
    expect(embedded).toContain('href="data:image/png;base64,AAA"');
    // Without bytes it degrades to a placeholder box, not a dead reference.
    const bare = elementToSvgNode(image);
    expect(bare).toContain("<rect ");
    expect(bare).not.toContain("<image");
  });
});

describe("elementsToSvg", () => {
  const group = [
    el({ id: "back", x: 0, y: 0, width: 200, height: 100, layerIndex: 0, fill: "#eeeeee" }),
    el({ id: "front", x: 20, y: 20, width: 40, height: 40, layerIndex: 5, fill: "#ff0000" }),
  ];

  it("paints back to front inside a viewBox around the content", () => {
    const svg = elementsToSvg(group);
    expect(svg.indexOf("#eeeeee")).toBeLessThan(svg.indexOf("#ff0000"));
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg).toContain('width="200"');
  });

  it("is a standalone document with the SVG namespace", () => {
    expect(elementsToSvg(group).startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(elementsToSvg(group).trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("declares a drop shadow filter only for elements that have one", () => {
    expect(elementsToSvg(group)).not.toContain("<defs>");
    const withShadow = elementsToSvg([el({ id: "s", shadowBlur: 10, shadowColor: "#000000" })]);
    expect(withShadow).toContain("feDropShadow");
    expect(withShadow).toContain('filter="url(#shadow-s)"');
  });

  it("paints a background behind everything when asked", () => {
    const svg = elementsToSvg(group, { background: "#111111" });
    expect(svg.indexOf("#111111")).toBeLessThan(svg.indexOf("#eeeeee"));
  });
});
