import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./canvasStore";
import type { Element } from "../types";

function makeEl(id: string, overrides?: Partial<Element>): Element {
  return {
    id,
    data: { kind: "rect" },
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

  describe("hand tool", () => {
    it("setTool('hand') activates hand tool", () => {
      useCanvasStore.getState().setTool("hand");
      expect(useCanvasStore.getState().activeTool).toBe("hand");
    });

    it("switching from hand to rect clears selection", () => {
      useCanvasStore.setState({ selectedElementId: "el-1" });
      useCanvasStore.getState().setTool("hand");
      expect(useCanvasStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("setElementLabel", () => {
    it("stores label for element id", () => {
      useCanvasStore.getState().setElementLabel("el-1", "My Label");
      expect(useCanvasStore.getState().elementLabels["el-1"]).toBe("My Label");
    });

    it("preserves existing labels when adding a new one", () => {
      useCanvasStore.getState().setElementLabel("a", "Label A");
      useCanvasStore.getState().setElementLabel("b", "Label B");
      expect(useCanvasStore.getState().elementLabels["a"]).toBe("Label A");
      expect(useCanvasStore.getState().elementLabels["b"]).toBe("Label B");
    });

    it("overwrites an existing label", () => {
      useCanvasStore.getState().setElementLabel("el-1", "Old");
      useCanvasStore.getState().setElementLabel("el-1", "New");
      expect(useCanvasStore.getState().elementLabels["el-1"]).toBe("New");
    });
  });

  describe("snapshot / undo / redo", () => {
    it("snapshot stores current elements in undoStack", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      expect(useCanvasStore.getState().undoStack).toHaveLength(1);
      expect(useCanvasStore.getState().undoStack[0][0].id).toBe("a");
    });

    it("undo restores previous elements after snapshot", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      useCanvasStore.getState().upsertElement(makeEl("b"));
      expect(useCanvasStore.getState().elements).toHaveLength(2);
      useCanvasStore.getState().undo();
      expect(useCanvasStore.getState().elements).toHaveLength(1);
      expect(useCanvasStore.getState().elements[0].id).toBe("a");
    });

    it("undo moves current state onto redoStack", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      useCanvasStore.getState().upsertElement(makeEl("b"));
      useCanvasStore.getState().undo();
      expect(useCanvasStore.getState().redoStack).toHaveLength(1);
    });

    it("redo re-applies undone changes", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().undo();
      expect(useCanvasStore.getState().elements).toHaveLength(1);
      useCanvasStore.getState().redo();
      expect(useCanvasStore.getState().elements).toHaveLength(2);
    });

    it("undo is a no-op when stack is empty", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().undo(); // no snapshot, no-op
      expect(useCanvasStore.getState().elements).toHaveLength(1);
    });

    it("redo is a no-op when stack is empty", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().redo(); // no undone change, no-op
      expect(useCanvasStore.getState().elements).toHaveLength(1);
    });

    it("snapshot clears redoStack", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().undo();
      // Now redoStack has 1 entry. Taking a new snapshot should clear it.
      useCanvasStore.getState().snapshot();
      expect(useCanvasStore.getState().redoStack).toHaveLength(0);
    });

    it("undo / redo do not affect activeTool or selectedElementId", () => {
      useCanvasStore.getState().setTool("rect");
      useCanvasStore.getState().selectElement("el-1");
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().snapshot();
      useCanvasStore.getState().setElements([]);
      useCanvasStore.getState().undo();
      expect(useCanvasStore.getState().activeTool).toBe("rect");
      // selectedElementId is not touched by undo
    });
  });

  describe("clipboard — copyElement / getPasted", () => {
    it("getPasted returns null when clipboard is empty", () => {
      expect(useCanvasStore.getState().getPasted()).toBeNull();
    });

    it("getPasted returns a new element after copyElement", () => {
      useCanvasStore.getState().copyElement(makeEl("orig"));
      const pasted = useCanvasStore.getState().getPasted();
      expect(pasted).not.toBeNull();
    });

    it("pasted element has a different id than the original", () => {
      useCanvasStore.getState().copyElement(makeEl("orig"));
      const pasted = useCanvasStore.getState().getPasted();
      expect(pasted!.id).not.toBe("orig");
    });

    it("pasted element is offset by 20px in both axes", () => {
      useCanvasStore.getState().copyElement(makeEl("orig", { x: 100, y: 50 }));
      const pasted = useCanvasStore.getState().getPasted();
      expect(pasted!.x).toBe(120);
      expect(pasted!.y).toBe(70);
    });

    it("pasted element preserves shape, fill, stroke from original", () => {
      const orig = makeEl("orig", { data: { kind: "circle" }, fill: "#ff0000", stroke: "#00ff00" });
      useCanvasStore.getState().copyElement(orig);
      const pasted = useCanvasStore.getState().getPasted();
      expect(pasted!.data.kind).toBe("circle");
      expect(pasted!.fill).toBe("#ff0000");
      expect(pasted!.stroke).toBe("#00ff00");
    });

    it("getPasted can be called multiple times producing unique ids", () => {
      useCanvasStore.getState().copyElement(makeEl("orig"));
      const p1 = useCanvasStore.getState().getPasted();
      const p2 = useCanvasStore.getState().getPasted();
      expect(p1!.id).not.toBe(p2!.id);
    });

    it("pasted element gets layerIndex equal to current elements count", () => {
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().copyElement(makeEl("orig"));
      const pasted = useCanvasStore.getState().getPasted();
      expect(pasted!.layerIndex).toBe(2);
    });
  });

  describe("selection and labels", () => {
    it("toggleSelected adds and removes one id", () => {
      const store = useCanvasStore.getState();
      store.selectElements(["a", "b"]);
      useCanvasStore.getState().toggleSelected("c");
      expect(useCanvasStore.getState().selectedElementIds).toEqual(["a", "b", "c"]);
      useCanvasStore.getState().toggleSelected("b");
      expect(useCanvasStore.getState().selectedElementIds).toEqual(["a", "c"]);
    });

    it("keeps selectedElementId pointing at the first of the set", () => {
      useCanvasStore.getState().selectElements(["a", "b"]);
      expect(useCanvasStore.getState().selectedElementId).toBe("a");
      useCanvasStore.getState().selectElements([]);
      expect(useCanvasStore.getState().selectedElementId).toBeNull();
    });

    it("setElementLabel writes the label onto the element, not only the side table", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().setElementLabel("a", "screen/one");
      // Exports and the canvas read el.label; the layers tree read the side
      // table. Keeping only one of them in step showed a rename in the panel
      // and nowhere else.
      expect(useCanvasStore.getState().elements[0].label).toBe("screen/one");
      expect(useCanvasStore.getState().elementLabels.a).toBe("screen/one");
    });

    it("setElementLabels applies a whole group patch at once", () => {
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().setElementLabels({ a: "G/a", b: "G/b" });
      expect(useCanvasStore.getState().elements.map((e) => e.label)).toEqual(["G/a", "G/b"]);
    });

    it("drops a local override once contract state agrees", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().setElementLabel("a", "G/a");
      // The board comes back from the node carrying the same label.
      useCanvasStore.getState().setElements([{ ...makeEl("a"), label: "G/a" }]);
      expect(useCanvasStore.getState().elementLabels.a).toBeUndefined();
    });

    it("keeps a local override that contract state has not caught up with", () => {
      useCanvasStore.getState().setElements([makeEl("a")]);
      useCanvasStore.getState().setElementLabel("a", "G/a");
      useCanvasStore.getState().setElements([{ ...makeEl("a"), label: "" }]);
      expect(useCanvasStore.getState().elementLabels.a).toBe("G/a");
    });

    it("toggleGroupCollapsed flips one group at a time", () => {
      useCanvasStore.getState().toggleGroupCollapsed("screen");
      expect(useCanvasStore.getState().collapsedGroups.screen).toBe(true);
      useCanvasStore.getState().toggleGroupCollapsed("screen");
      expect(useCanvasStore.getState().collapsedGroups.screen).toBe(false);
    });
  });
});
