import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";
import type { Layer } from "../types";
import { NEUTRAL_ADJUSTMENTS } from "../types";

function layer(id: string, index: number): Layer {
  return {
    id, name: id, kind: "raster", parentId: null, layerIndex: index,
    visible: true, locked: false, opacity: 100, blendMode: "normal",
    x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 100, scaleY: 100,
    blobId: "", maskBlobId: null, fill: "",
    adjustments: { ...NEUTRAL_ADJUSTMENTS }, text: null,
    createdBy: "me", createdAt: 1, updatedAt: 1,
  };
}

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: [], selectedLayerId: null, activeTool: "move", zoom: 1, panX: 0, panY: 0,
      undoStack: [], redoStack: [], myRole: "viewer", editingMaskOf: null,
    });
  });

  it("sorts layers by layerIndex on set", () => {
    useEditorStore.getState().setLayers([layer("b", 2), layer("a", 1)]);
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("upserts (insert + update) and keeps sort order", () => {
    const s = useEditorStore.getState();
    s.upsertLayer(layer("a", 1));
    s.upsertLayer(layer("c", 3));
    s.upsertLayer(layer("b", 2));
    expect(useEditorStore.getState().layers.map((l) => l.id)).toEqual(["a", "b", "c"]);
    s.upsertLayer({ ...layer("b", 2), name: "renamed" });
    expect(useEditorStore.getState().layers.find((l) => l.id === "b")?.name).toBe("renamed");
  });

  it("removes a layer and clears selection if it was selected", () => {
    const s = useEditorStore.getState();
    s.setLayers([layer("a", 1)]);
    s.selectLayer("a");
    s.removeLayer("a");
    expect(useEditorStore.getState().layers).toHaveLength(0);
    expect(useEditorStore.getState().selectedLayerId).toBeNull();
  });

  it("clamps zoom into range", () => {
    useEditorStore.getState().setZoom(999);
    expect(useEditorStore.getState().zoom).toBeLessThanOrEqual(16);
    useEditorStore.getState().setZoom(0);
    expect(useEditorStore.getState().zoom).toBeGreaterThan(0);
  });

  it("gates editing on role", () => {
    expect(useEditorStore.getState().canEdit()).toBe(false);
    useEditorStore.getState().setRole("editor");
    expect(useEditorStore.getState().canEdit()).toBe(true);
    useEditorStore.getState().setRole("admin");
    expect(useEditorStore.getState().canEdit()).toBe(true);
  });

  it("swaps primary/secondary colors", () => {
    useEditorStore.setState({ primaryColor: "#111111", secondaryColor: "#eeeeee" });
    useEditorStore.getState().swapColors();
    expect(useEditorStore.getState().primaryColor).toBe("#eeeeee");
    expect(useEditorStore.getState().secondaryColor).toBe("#111111");
  });

  it("undo/redo restores layer metadata", () => {
    const s = useEditorStore.getState();
    s.setLayers([layer("a", 1)]);
    s.pushHistory([]); // snapshot before change
    s.upsertLayer({ ...layer("a", 1), opacity: 30 });
    expect(useEditorStore.getState().layers[0].opacity).toBe(30);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().layers[0].opacity).toBe(100);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().layers[0].opacity).toBe(30);
  });
});
