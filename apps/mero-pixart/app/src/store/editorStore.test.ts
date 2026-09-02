import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_PANEL_COLLAPSED, normalizeLayer, useEditorStore } from "./editorStore";
import type { Layer } from "../types";
import { makeGroup, makeLayer } from "../test/factories";

function layer(id: string, index: number): Layer {
  return makeLayer({ id, name: id, layerIndex: index, width: 10, height: 10, createdBy: "me" });
}

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: [], selectedLayerId: null, selectedLayerIds: [], activeTool: "move",
      transformMode: "free", zoom: 1, panX: 0, panY: 0,
      undoStack: [], redoStack: [], myRole: "viewer", editingMaskOf: null,
      collapsedGroups: {}, guides: [], selection: null,
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

// ── Transform-field normalisation ───────────────────────────────────────────
describe("normalizeLayer", () => {
  it("fills in transform fields an older stored layer omits", () => {
    // `#[serde(default)]` on the contract means these simply are not in the JSON.
    const legacy = { ...layer("old", 0) } as Partial<Layer> as Layer;
    delete (legacy as Partial<Layer>).skewX;
    delete (legacy as Partial<Layer>).skewY;
    delete (legacy as Partial<Layer>).flipH;
    delete (legacy as Partial<Layer>).flipV;
    delete (legacy as Partial<Layer>).warp;

    const fixed = normalizeLayer(legacy);
    expect(fixed).toMatchObject({ skewX: 0, skewY: 0, flipH: false, flipV: false, warp: "" });
  });

  it("hands a complete layer straight back, allocating nothing", () => {
    const complete = layer("new", 0);
    expect(normalizeLayer(complete)).toBe(complete);
  });

  it("is applied on the way into the store, both paths", () => {
    const legacy = { ...layer("a", 0) } as Partial<Layer> as Layer;
    delete (legacy as Partial<Layer>).flipH;
    useEditorStore.getState().setLayers([legacy]);
    expect(useEditorStore.getState().layers[0].flipH).toBe(false);

    const other = { ...layer("b", 1) } as Partial<Layer> as Layer;
    delete (other as Partial<Layer>).skewX;
    useEditorStore.getState().upsertLayer(other);
    expect(useEditorStore.getState().layers[1].skewX).toBe(0);
  });
});

// ── Folder-aware selection ──────────────────────────────────────────────────
describe("selection with folders", () => {
  //  Header (group) ▸ Logo, Nav (group) ▸ Nav item ;  plus a loose Background
  function seed() {
    useEditorStore.getState().setLayers([
      makeLayer({ id: "bg", layerIndex: 0 }),
      makeLayer({ id: "nav-item", layerIndex: 10, parentId: "nav" }),
      makeGroup({ id: "nav", layerIndex: 20, parentId: "header" }),
      makeLayer({ id: "logo", layerIndex: 30, parentId: "header" }),
      makeGroup({ id: "header", layerIndex: 40 }),
    ]);
  }

  beforeEach(seed);

  it("selecting a folder selects its contents, folder last", () => {
    useEditorStore.getState().selectLayer("header");
    const { selectedLayerId, selectedLayerIds } = useEditorStore.getState();
    expect(selectedLayerIds.sort()).toEqual(["header", "logo", "nav", "nav-item"]);
    expect(selectedLayerId).toBe("header");
  });

  it("selectSubtree does the same thing by name", () => {
    useEditorStore.getState().selectSubtree("nav");
    expect(useEditorStore.getState().selectedLayerIds.sort()).toEqual(["nav", "nav-item"]);
  });

  it("selecting a plain layer selects exactly that layer", () => {
    useEditorStore.getState().selectLayer("bg");
    expect(useEditorStore.getState().selectedLayerIds).toEqual(["bg"]);
  });

  it("clearing the selection empties the set", () => {
    useEditorStore.getState().selectLayer("header");
    useEditorStore.getState().selectLayer(null);
    expect(useEditorStore.getState().selectedLayerIds).toEqual([]);
    expect(useEditorStore.getState().selectedLayerId).toBeNull();
  });

  it("setSelectedLayers expands folders and keeps the last id primary", () => {
    useEditorStore.getState().setSelectedLayers(["bg", "nav"]);
    const s = useEditorStore.getState();
    expect(s.selectedLayerIds.sort()).toEqual(["bg", "nav", "nav-item"]);
    expect(s.selectedLayerId).toBe("nav");
  });

  it("cmd-clicking a folder adds its contents, and removes them again", () => {
    const s = () => useEditorStore.getState();
    s().selectLayer("bg");
    s().toggleLayerSelection("nav");
    expect(s().selectedLayerIds.sort()).toEqual(["bg", "nav", "nav-item"]);
    s().toggleLayerSelection("nav");
    expect(s().selectedLayerIds).toEqual(["bg"]);
    expect(s().selectedLayerId).toBe("bg");
  });

  it("removing a layer drops it from the multi-selection", () => {
    useEditorStore.getState().selectLayer("header");
    useEditorStore.getState().removeLayer("logo");
    expect(useEditorStore.getState().selectedLayerIds).not.toContain("logo");
  });

  it("leaves mask and text editing when the selection changes", () => {
    useEditorStore.setState({ editingMaskOf: "bg", editingTextId: "bg" });
    useEditorStore.getState().selectLayer("logo");
    expect(useEditorStore.getState().editingMaskOf).toBeNull();
    expect(useEditorStore.getState().editingTextId).toBeNull();
  });
});

// ── Folder collapse (per-user view state) ───────────────────────────────────
describe("collapsedGroups", () => {
  beforeEach(() => {
    useEditorStore.getState().setLayers([
      makeGroup({ id: "g1", layerIndex: 1 }),
      makeGroup({ id: "g2", layerIndex: 2 }),
      makeLayer({ id: "plain", layerIndex: 0 }),
    ]);
  });

  it("toggles one folder", () => {
    useEditorStore.getState().toggleGroupCollapsed("g1");
    expect(useEditorStore.getState().collapsedGroups.g1).toBe(true);
    useEditorStore.getState().toggleGroupCollapsed("g1");
    expect(useEditorStore.getState().collapsedGroups.g1).toBe(false);
  });

  it("sets one folder explicitly", () => {
    useEditorStore.getState().setGroupCollapsed("g2", true);
    expect(useEditorStore.getState().collapsedGroups.g2).toBe(true);
  });

  it("collapses and expands every folder, ignoring plain layers", () => {
    useEditorStore.getState().setAllGroupsCollapsed(true);
    expect(useEditorStore.getState().collapsedGroups).toEqual({ g1: true, g2: true });
    useEditorStore.getState().setAllGroupsCollapsed(false);
    expect(useEditorStore.getState().collapsedGroups).toEqual({ g1: false, g2: false });
  });
});

// ── Transform mode ──────────────────────────────────────────────────────────
describe("transformMode", () => {
  it("switches between the free gizmo and the warp pins", () => {
    expect(useEditorStore.getState().transformMode).toBe("free");
    useEditorStore.getState().setTransformMode("warp");
    expect(useEditorStore.getState().transformMode).toBe("warp");
  });
});

// ── History ─────────────────────────────────────────────────────────────────
describe("history", () => {
  beforeEach(() => {
    useEditorStore.getState().setLayers([layer("a", 0)]);
    useEditorStore.getState().clearHistory();
  });

  it("labels entries for the History panel", () => {
    useEditorStore.getState().pushHistory([], "Group Layers");
    const stack = useEditorStore.getState().undoStack;
    expect(stack[stack.length - 1]?.label).toBe("Group Layers");
  });

  it("defaults the label rather than showing 'undefined'", () => {
    useEditorStore.getState().pushHistory([]);
    const stack = useEditorStore.getState().undoStack;
    expect(stack[stack.length - 1]?.label).toBe("Edit");
  });

  it("a new edit clears the redo branch", () => {
    const s = () => useEditorStore.getState();
    s().pushHistory([], "one");
    s().upsertLayer({ ...layer("a", 0), opacity: 50 });
    s().undo();
    expect(s().redoStack).toHaveLength(1);
    s().pushHistory([], "two");
    expect(s().redoStack).toHaveLength(0);
  });

  it("undo and redo are no-ops on an empty stack", () => {
    expect(() => { useEditorStore.getState().undo(); useEditorStore.getState().redo(); }).not.toThrow();
  });

  it("caps the stack so a long session cannot grow without bound", () => {
    for (let i = 0; i < 60; i++) useEditorStore.getState().pushHistory([], `edit ${i}`);
    expect(useEditorStore.getState().undoStack.length).toBeLessThanOrEqual(40);
    // the OLDEST entries are the ones dropped
    expect(useEditorStore.getState().undoStack[0].label).not.toBe("edit 0");
  });

  it("jumpHistory walks backwards and forwards to a target depth", () => {
    const s = () => useEditorStore.getState();
    s().pushHistory([], "one");
    s().upsertLayer({ ...layer("a", 0), opacity: 80 });
    s().pushHistory([], "two");
    s().upsertLayer({ ...layer("a", 0), opacity: 60 });
    expect(s().undoStack).toHaveLength(2);

    s().jumpHistory(0);
    expect(s().undoStack).toHaveLength(0);
    expect(s().layers[0].opacity).toBe(100);

    s().jumpHistory(2);
    expect(s().undoStack).toHaveLength(2);
    expect(s().layers[0].opacity).toBe(60);
  });

  it("clamps a negative jump target", () => {
    useEditorStore.getState().pushHistory([], "one");
    expect(() => useEditorStore.getState().jumpHistory(-5)).not.toThrow();
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it("restores the document size too, so a crop is undoable", () => {
    const s = () => useEditorStore.getState();
    const doc = {
      name: "d", description: "", width: 100, height: 100,
      background: "#000", layerCount: 0, memberCount: 1, owner: null,
    };
    s().setDoc(doc);
    s().pushHistory([], "Crop");
    s().setDoc({ ...doc, width: 50, height: 50 });
    s().undo();
    expect(useEditorStore.getState().doc).toMatchObject({ width: 100, height: 100 });
  });
});

// ── Guides, panels, view ────────────────────────────────────────────────────
describe("guides and panels", () => {
  it("adds, moves, removes and clears guides with rounded positions", () => {
    const s = () => useEditorStore.getState();
    s().addGuide("h", 40.6);
    const id = s().guides[0].id;
    expect(s().guides[0]).toMatchObject({ orient: "h", pos: 41 });
    s().moveGuide(id, 12.2);
    expect(s().guides[0].pos).toBe(12);
    s().removeGuide(id);
    expect(s().guides).toHaveLength(0);
    s().addGuide("v", 10);
    s().addGuide("v", 20);
    s().clearGuides();
    expect(s().guides).toHaveLength(0);
  });

  it("toggles the Transform panel like any other dock panel", () => {
    const s = () => useEditorStore.getState();
    const before = s().panels.transform;
    s().togglePanel("transform");
    expect(s().panels.transform).toBe(!before);
    // Transform ships COLLAPSED (five open panels would push Layers off the
    // dock), so the first toggle opens it.
    const collapsedBefore = s().panelCollapsed.transform;
    s().togglePanelCollapsed("transform");
    expect(s().panelCollapsed.transform).toBe(!collapsedBefore);
  });

  it("ships with Transform and History collapsed, and Layers open", () => {
    // Regression guard: adding a fifth EXPANDED dock panel pushed the Layers
    // panel below the fold on a 1000px-tall window.
    expect(DEFAULT_PANEL_COLLAPSED).toMatchObject({
      transform: true, history: true, layers: false,
    });
    // and the store really starts from it
    expect(useEditorStore.getInitialState().panelCollapsed).toEqual(DEFAULT_PANEL_COLLAPSED);
  });

  it("patches view settings without dropping the others", () => {
    const s = () => useEditorStore.getState();
    s().setView({ showGrid: true });
    s().setView({ units: "cm" });
    expect(s().view).toMatchObject({ showGrid: true, units: "cm", snap: true });
  });
});
