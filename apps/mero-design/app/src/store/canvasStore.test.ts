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

  describe("upsertElements", () => {
    it("replaces existing elements in place and appends new ones, in order", () => {
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b"), makeEl("c")]);
      useCanvasStore.getState().upsertElements([makeEl("c", { x: 3 }), makeEl("n1"), makeEl("a", { x: 1 }), makeEl("n2")]);
      const els = useCanvasStore.getState().elements;
      expect(els.map((e) => e.id)).toEqual(["a", "b", "c", "n1", "n2"]);
      expect([els[0].x, els[2].x]).toEqual([1, 3]);
    });

    it("is ONE store update however many elements it carries", () => {
      useCanvasStore.getState().setElements([]);
      let updates = 0;
      const unsub = useCanvasStore.subscribe(() => { updates++; });
      useCanvasStore.getState().upsertElements(Array.from({ length: 3000 }, (_, i) => makeEl(`p${i}`)));
      unsub();
      expect(updates).toBe(1);
      expect(useCanvasStore.getState().elements).toHaveLength(3000);
    });

    it("keeps the last copy of a duplicated id", () => {
      useCanvasStore.getState().setElements([]);
      useCanvasStore.getState().upsertElements([makeEl("d", { x: 1 }), makeEl("d", { x: 2 })]);
      const els = useCanvasStore.getState().elements;
      expect(els).toHaveLength(1);
      expect(els[0].x).toBe(2);
    });
  });

  describe("removeElements", () => {
    it("removes every id in one update and ignores unknown ones", () => {
      useCanvasStore.getState().setElements([makeEl("x"), makeEl("y"), makeEl("z")]);
      let updates = 0;
      const unsub = useCanvasStore.subscribe(() => { updates++; });
      useCanvasStore.getState().removeElements(["x", "z", "gone"]);
      unsub();
      expect(useCanvasStore.getState().elements.map((e) => e.id)).toEqual(["y"]);
      expect(updates).toBe(1);
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
    const store = () => useCanvasStore.getState();
    const ids = () => store().elements.map((e) => e.id);
    const byId = (id: string) => store().elements.find((e) => e.id === id);

    beforeEach(() => {
      useCanvasStore.setState({ undoStack: [], redoStack: [], historyOpen: false, elementLabels: {} });
    });

    it("records a local edit as one step, with the element before and after", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("a", { x: 50 }));
      expect(store().undoStack).toHaveLength(1);
      const change = store().undoStack[0].changes.a;
      expect(change.before?.x).toBe(10);
      expect(change.after?.x).toBe(50);
    });

    it("a board load is not an edit and is not undoable", () => {
      store().setElements([makeEl("a")]);
      expect(store().undoStack).toHaveLength(0);
      expect(store().undo()).toBeNull();
      expect(ids()).toEqual(["a"]);
    });

    it("undo of a create deletes it, and says so for the node", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("b"));
      const plan = store().undo();
      expect(ids()).toEqual(["a"]);
      expect(plan).toEqual({ upserts: [], deletes: ["b"] });
    });

    it("undo of a delete puts the element back, and redo deletes it again", () => {
      store().setElements([makeEl("a", { fill: "#123456" })]);
      store().snapshot();
      store().removeElements(["a"]);
      const undo = store().undo();
      expect(byId("a")?.fill).toBe("#123456");
      expect(undo?.upserts.map((e) => e.id)).toEqual(["a"]);
      const redo = store().redo();
      expect(ids()).toEqual([]);
      expect(redo).toEqual({ upserts: [], deletes: ["a"] });
    });

    it("undo writes the restored element with a fresh updatedAt, so it wins last-writer-wins", () => {
      store().setElements([makeEl("a", { updatedAt: 1 })]);
      store().snapshot();
      store().upsertElement(makeEl("a", { x: 50, updatedAt: 2 }));
      const plan = store().undo();
      expect(plan?.upserts[0].x).toBe(10);
      expect(plan?.upserts[0].updatedAt).toBeGreaterThan(2);
    });

    // The bug: undo swapped in a copy of the whole board, so a teammate's work
    // that arrived after the action was thrown away with it.
    it("undoing my move keeps a teammate's shape that arrived after it", () => {
      store().setElements([makeEl("mine", { x: 0 })]);
      store().snapshot();
      store().upsertElement(makeEl("mine", { x: 50 }));
      store().applyRemoteElements([makeEl("theirs", { x: 99 })]);
      store().undo();
      expect(byId("mine")?.x).toBe(0);
      expect(byId("theirs")?.x).toBe(99);
    });

    it("undoing my move keeps a teammate's recolour of the same shape", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("a", { x: 50 }));
      store().applyRemoteElements([makeEl("a", { x: 50, fill: "#ff0000" })]);
      const plan = store().undo();
      expect(byId("a")?.x).toBe(10);
      expect(byId("a")?.fill).toBe("#ff0000");
      expect(plan?.upserts[0].fill).toBe("#ff0000");
    });

    it("does not resurrect a shape a teammate deleted since", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("a", { x: 50 }));
      store().removeRemoteElements(["a"]);
      expect(store().undo()).toEqual({ upserts: [], deletes: [] });
      expect(ids()).toEqual([]);
    });

    it("changes read back from the node are never recorded", () => {
      store().applyRemoteElements([makeEl("a")]);
      store().removeRemoteElements(["a"]);
      expect(store().undoStack).toHaveLength(0);
    });

    it("snapshot separates actions; changes without one coalesce into one step", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("a", { x: 1 }));
      store().upsertElement(makeEl("a", { x: 2 })); // a slider tick
      store().snapshot();
      store().upsertElement(makeEl("a", { y: 99 }));
      expect(store().undoStack).toHaveLength(2);
      store().undo();
      expect(byId("a")).toMatchObject({ x: 2, y: 20 });
      store().undo();
      expect(byId("a")).toMatchObject({ x: 10, y: 20 });
    });

    it("a step that came to nothing is not an undo", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("b"));
      store().removeElement("b");
      expect(store().undo()).toBeNull();
      expect(ids()).toEqual(["a"]);
    });

    it("undo moves the step onto redoStack, and a new edit clears it", () => {
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().upsertElement(makeEl("b"));
      store().undo();
      expect(store().redoStack).toHaveLength(1);
      store().snapshot();
      store().upsertElement(makeEl("c"));
      expect(store().redoStack).toHaveLength(0);
    });

    it("undo puts back a renamed layer's label and drops the local override", () => {
      store().setElements([makeEl("a", { label: "Old" })]);
      store().snapshot();
      store().setElementLabel("a", "New");
      store().undo();
      expect(byId("a")?.label).toBe("Old");
      expect(store().elementLabels.a).toBeUndefined();
    });

    it("undo and redo are no-ops when there is nothing to replay", () => {
      store().setElements([makeEl("a")]);
      expect(store().undo()).toBeNull();
      expect(store().redo()).toBeNull();
      expect(ids()).toEqual(["a"]);
    });

    it("undo / redo do not affect activeTool", () => {
      store().setTool("rect");
      store().setElements([makeEl("a")]);
      store().snapshot();
      store().removeElement("a");
      store().undo();
      expect(store().activeTool).toBe("rect");
    });
  });

  describe("clipboard — copyElements / getPasted", () => {
    it("getPasted returns nothing when the clipboard is empty", () => {
      expect(useCanvasStore.getState().getPasted()).toEqual([]);
    });

    it("copies and pastes a single element", () => {
      useCanvasStore.getState().copyElements([makeEl("orig")]);
      expect(useCanvasStore.getState().getPasted()).toHaveLength(1);
    });

    it("gives every pasted element a new id", () => {
      useCanvasStore.getState().copyElements([makeEl("a"), makeEl("b")]);
      const ids = useCanvasStore.getState().getPasted().map((e) => e.id);
      expect(ids).not.toContain("a");
      expect(ids).not.toContain("b");
      expect(new Set(ids).size).toBe(2);
    });

    it("offsets a pasted element by 20px in both axes", () => {
      useCanvasStore.getState().copyElements([makeEl("orig", { x: 100, y: 50 })]);
      const [pasted] = useCanvasStore.getState().getPasted();
      expect(pasted!.x).toBe(120);
      expect(pasted!.y).toBe(70);
    });

    it("preserves shape, fill and stroke", () => {
      const orig = makeEl("orig", { data: { kind: "circle" }, fill: "#ff0000", stroke: "#00ff00" });
      useCanvasStore.getState().copyElements([orig]);
      const [pasted] = useCanvasStore.getState().getPasted();
      expect(pasted!.data.kind).toBe("circle");
      expect(pasted!.fill).toBe("#ff0000");
      expect(pasted!.stroke).toBe("#00ff00");
    });

    it("produces unique ids on every call", () => {
      useCanvasStore.getState().copyElements([makeEl("orig")]);
      const [p1] = useCanvasStore.getState().getPasted();
      const [p2] = useCanvasStore.getState().getPasted();
      expect(p1!.id).not.toBe(p2!.id);
    });

    it("stacks a pasted element on top of what is already there", () => {
      useCanvasStore.getState().setElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().copyElements([makeEl("orig")]);
      const [pasted] = useCanvasStore.getState().getPasted();
      expect(pasted!.layerIndex).toBe(2);
    });

    // A copy is not one shape. This is what only worked for a single element.
    it("copies and pastes a whole multi-selection", () => {
      useCanvasStore.getState().copyElements([makeEl("a"), makeEl("b"), makeEl("c")]);
      expect(useCanvasStore.getState().getPasted()).toHaveLength(3);
    });

    it("keeps a batch's relative layout — one offset, not one per element", () => {
      useCanvasStore.getState().copyElements([
        makeEl("a", { x: 0, y: 0 }),
        makeEl("b", { x: 100, y: 40 }),
      ]);
      const [a, b] = useCanvasStore.getState().getPasted();
      expect([a!.x, a!.y]).toEqual([20, 20]);
      expect([b!.x, b!.y]).toEqual([120, 60]);
      // The gap between them is exactly the gap they were copied with.
      expect(b!.x - a!.x).toBe(100);
      expect(b!.y - a!.y).toBe(40);
    });

    it("stacks a pasted batch in layer order, above everything present", () => {
      useCanvasStore.getState().setElements([makeEl("x"), makeEl("y")]);
      useCanvasStore.getState().copyElements([
        makeEl("top", { layerIndex: 9 }),
        makeEl("bottom", { layerIndex: 1 }),
      ]);
      const pasted = useCanvasStore.getState().getPasted();
      // Sorted on copy, so the one that was underneath is still underneath.
      expect(pasted.map((e) => e.layerIndex)).toEqual([2, 3]);
      expect(pasted[0]!.data).toEqual(makeEl("bottom").data);
    });

    it("replaces the clipboard rather than appending to it", () => {
      useCanvasStore.getState().copyElements([makeEl("a"), makeEl("b")]);
      useCanvasStore.getState().copyElements([makeEl("c")]);
      expect(useCanvasStore.getState().getPasted()).toHaveLength(1);
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
