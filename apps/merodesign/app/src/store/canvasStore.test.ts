import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./canvasStore";
import type { Element } from "../types";

function makeEl(id: string, overrides?: Partial<Element>): Element {
  return {
    id,
    data: { kind: "Rect" },
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    fill: "#fff",
    stroke: "#000",
    strokeWidth: 1,
    opacity: 100,
    layerIndex: 0,
    createdBy: "test",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("canvasStore", () => {
  beforeEach(() => {
    useCanvasStore.setState({
      activeTool: "select",
      selectedElementId: null,
      elements: [],
      background: "#ffffff",
      imageCache: {},
    });
  });

  describe("setTool", () => {
    it("sets the active tool", () => {
      useCanvasStore.getState().setTool("rect");
      expect(useCanvasStore.getState().activeTool).toBe("rect");
    });

    it("clears selected element when tool changes", () => {
      useCanvasStore.setState({ selectedElementId: "el-1" });
      useCanvasStore.getState().setTool("circle");
      expect(useCanvasStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("selectElement", () => {
    it("sets selectedElementId", () => {
      useCanvasStore.getState().selectElement("el-42");
      expect(useCanvasStore.getState().selectedElementId).toBe("el-42");
    });

    it("clears selection with null", () => {
      useCanvasStore.setState({ selectedElementId: "el-1" });
      useCanvasStore.getState().selectElement(null);
      expect(useCanvasStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("setElements", () => {
    it("replaces entire elements array", () => {
      useCanvasStore.setState({ elements: [makeEl("old")] });
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      const { elements } = useCanvasStore.getState();
      expect(elements).toHaveLength(2);
      expect(elements[0].id).toBe("a");
    });
  });

  describe("upsertElement", () => {
    it("adds a new element", () => {
      useCanvasStore.getState().upsertElement(makeEl("new-1"));
      expect(useCanvasStore.getState().elements).toHaveLength(1);
      expect(useCanvasStore.getState().elements[0].id).toBe("new-1");
    });

    it("updates an existing element in place", () => {
      useCanvasStore.getState().upsertElement(makeEl("el-1", { fill: "#red" }));
      useCanvasStore.getState().upsertElement(makeEl("el-1", { fill: "#blue" }));
      const { elements } = useCanvasStore.getState();
      expect(elements).toHaveLength(1);
      expect(elements[0].fill).toBe("#blue");
    });

    it("preserves order when updating", () => {
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b"), makeEl("c")]);
      useCanvasStore.getState().upsertElement(makeEl("b", { x: 999 }));
      const ids = useCanvasStore.getState().elements.map((e) => e.id);
      expect(ids).toEqual(["a", "b", "c"]);
      expect(useCanvasStore.getState().elements[1].x).toBe(999);
    });
  });

  describe("removeElement", () => {
    it("removes element by id", () => {
      useCanvasStore.getState().setElements([makeEl("x"), makeEl("y"), makeEl("z")]);
      useCanvasStore.getState().removeElement("y");
      const ids = useCanvasStore.getState().elements.map((e) => e.id);
      expect(ids).toEqual(["x", "z"]);
    });

    it("is a no-op for unknown id", () => {
      useCanvasStore.getState().setElements([makeEl("x")]);
      useCanvasStore.getState().removeElement("unknown");
      expect(useCanvasStore.getState().elements).toHaveLength(1);
    });
  });

  describe("setBackground", () => {
    it("sets background to gray", () => {
      useCanvasStore.getState().setBackground("#808080");
      expect(useCanvasStore.getState().background).toBe("#808080");
    });

    it("sets background to black", () => {
      useCanvasStore.getState().setBackground("#111111");
      expect(useCanvasStore.getState().background).toBe("#111111");
    });

    it("sets background to white", () => {
      useCanvasStore.getState().setBackground("#ffffff");
      expect(useCanvasStore.getState().background).toBe("#ffffff");
    });
  });

  describe("cacheImage", () => {
    it("stores a data URL keyed by element id", () => {
      useCanvasStore.getState().cacheImage("img-1", "data:image/png;base64,abc");
      expect(useCanvasStore.getState().imageCache["img-1"]).toBe("data:image/png;base64,abc");
    });

    it("does not overwrite other cache entries", () => {
      useCanvasStore.getState().cacheImage("a", "url-a");
      useCanvasStore.getState().cacheImage("b", "url-b");
      expect(useCanvasStore.getState().imageCache["a"]).toBe("url-a");
      expect(useCanvasStore.getState().imageCache["b"]).toBe("url-b");
    });
  });
});
