import { create } from "zustand";
import type {
  BrushType, DocumentInfo, GradientFill, GradientType, Layer, Role, Selection, ShapeKind, Tool,
} from "../types";
import { snapshotLayerCanvas, setLayerCanvas, getLayerCanvas } from "./layerCanvases";
import { ctx2d, loadImageFromSrc } from "../utils/raster";

const MAX_HISTORY = 40;

// A history entry captures the layers metadata plus a pixel snapshot (dataURL)
// of any layer canvases that the operation is about to mutate.
interface HistoryEntry {
  layers: Layer[];
  pixels: Record<string, string>; // layerId -> dataURL
  selectedLayerId: string | null;
}

export interface EditorState {
  doc: DocumentInfo | null;
  layers: Layer[];
  selectedLayerId: string | null;
  editingMaskOf: string | null; // layer id whose mask is being painted, or null
  editingTextId: string | null; // text layer being edited inline, or null

  activeTool: Tool;
  zoom: number;
  panX: number;
  panY: number;

  primaryColor: string;
  secondaryColor: string;
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
  brushType: BrushType;

  // ── tool options ──
  selection: Selection | null;
  shapeKind: ShapeKind;
  shapeStroke: boolean; // stroke (outline) instead of fill
  gradientType: GradientType;
  gradientFill: GradientFill;
  cloneSource: { layerId: string; x: number; y: number } | null;

  myRole: Role;
  /** bump to force the compositor to redraw (after imperative pixel mutations) */
  renderTick: number;

  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // ── setters ──
  setDoc: (doc: DocumentInfo | null) => void;
  setLayers: (layers: Layer[]) => void;
  upsertLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
  setEditingMask: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  setPrimaryColor: (c: string) => void;
  setSecondaryColor: (c: string) => void;
  swapColors: () => void;
  setBrush: (patch: Partial<{ size: number; hardness: number; opacity: number; type: BrushType }>) => void;
  setSelection: (s: Selection | null) => void;
  setShapeKind: (k: ShapeKind) => void;
  setShapeStroke: (v: boolean) => void;
  setGradientType: (t: GradientType) => void;
  setGradientFill: (f: GradientFill) => void;
  setCloneSource: (s: { layerId: string; x: number; y: number } | null) => void;
  setRole: (r: Role) => void;
  bumpRender: () => void;

  // ── history ──
  pushHistory: (affectedLayerIds: string[]) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  selectedLayer: () => Layer | undefined;
  canEdit: () => boolean;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  doc: null,
  layers: [],
  selectedLayerId: null,
  editingMaskOf: null,
  editingTextId: null,

  activeTool: "move",
  zoom: 1,
  panX: 0,
  panY: 0,

  primaryColor: "#A5FF11",
  secondaryColor: "#0F1419",
  brushSize: 24,
  brushHardness: 80,
  brushOpacity: 100,
  brushType: "soft",

  selection: null,
  shapeKind: "rectangle",
  shapeStroke: false,
  gradientType: "linear",
  gradientFill: "fg-transparent",
  cloneSource: null,

  myRole: "viewer",
  renderTick: 0,

  undoStack: [],
  redoStack: [],

  setDoc: (doc) => set({ doc }),

  setLayers: (layers) => set({ layers: [...layers].sort((a, b) => a.layerIndex - b.layerIndex) }),

  upsertLayer: (layer) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === layer.id);
      const next = idx >= 0
        ? s.layers.map((l) => (l.id === layer.id ? layer : l))
        : [...s.layers, layer];
      next.sort((a, b) => a.layerIndex - b.layerIndex);
      return { layers: next };
    }),

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
    })),

  selectLayer: (id) => set({ selectedLayerId: id, editingMaskOf: null }),
  setEditingMask: (id) => set({ editingMaskOf: id }),
  setEditingText: (id) => set({ editingTextId: id }),
  setTool: (t) => set({ activeTool: t }),
  setZoom: (z) => set({ zoom: Math.min(16, Math.max(0.05, z)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setPrimaryColor: (c) => set({ primaryColor: c }),
  setSecondaryColor: (c) => set({ secondaryColor: c }),
  swapColors: () => set((s) => ({ primaryColor: s.secondaryColor, secondaryColor: s.primaryColor })),
  setBrush: (patch) =>
    set((s) => ({
      brushSize: patch.size ?? s.brushSize,
      brushHardness: patch.hardness ?? s.brushHardness,
      brushOpacity: patch.opacity ?? s.brushOpacity,
      brushType: patch.type ?? s.brushType,
    })),
  setSelection: (selection) => set({ selection }),
  setShapeKind: (shapeKind) => set({ shapeKind }),
  setShapeStroke: (shapeStroke) => set({ shapeStroke }),
  setGradientType: (gradientType) => set({ gradientType }),
  setGradientFill: (gradientFill) => set({ gradientFill }),
  setCloneSource: (cloneSource) => set({ cloneSource }),
  setRole: (r) => set({ myRole: r }),
  bumpRender: () => set((s) => ({ renderTick: s.renderTick + 1 })),

  pushHistory: (affectedLayerIds) =>
    set((s) => {
      const pixels: Record<string, string> = {};
      for (const id of affectedLayerIds) {
        const snap = snapshotLayerCanvas(id);
        if (snap) pixels[id] = snap;
      }
      const entry: HistoryEntry = {
        layers: s.layers.map((l) => ({ ...l })),
        pixels,
        selectedLayerId: s.selectedLayerId,
      };
      const undoStack = [...s.undoStack, entry].slice(-MAX_HISTORY);
      return { undoStack, redoStack: [] };
    }),

  undo: () => {
    const s = get();
    const entry = s.undoStack[s.undoStack.length - 1];
    if (!entry) return;
    // capture current state into redo
    const redoPixels: Record<string, string> = {};
    for (const id of Object.keys(entry.pixels)) {
      const snap = snapshotLayerCanvas(id);
      if (snap) redoPixels[id] = snap;
    }
    const redoEntry: HistoryEntry = {
      layers: s.layers.map((l) => ({ ...l })),
      pixels: redoPixels,
      selectedLayerId: s.selectedLayerId,
    };
    restorePixels(entry.pixels, entry.layers);
    set({
      layers: entry.layers,
      selectedLayerId: entry.selectedLayerId,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, redoEntry].slice(-MAX_HISTORY),
      renderTick: s.renderTick + 1,
    });
  },

  redo: () => {
    const s = get();
    const entry = s.redoStack[s.redoStack.length - 1];
    if (!entry) return;
    const undoPixels: Record<string, string> = {};
    for (const id of Object.keys(entry.pixels)) {
      const snap = snapshotLayerCanvas(id);
      if (snap) undoPixels[id] = snap;
    }
    const undoEntry: HistoryEntry = {
      layers: s.layers.map((l) => ({ ...l })),
      pixels: undoPixels,
      selectedLayerId: s.selectedLayerId,
    };
    restorePixels(entry.pixels, entry.layers);
    set({
      layers: entry.layers,
      selectedLayerId: entry.selectedLayerId,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, undoEntry].slice(-MAX_HISTORY),
      renderTick: s.renderTick + 1,
    });
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),

  selectedLayer: () => {
    const s = get();
    return s.layers.find((l) => l.id === s.selectedLayerId);
  },

  canEdit: () => {
    const r = get().myRole;
    return r === "admin" || r === "editor";
  },
}));

// Restore pixel snapshots onto layer canvases. Async (image decode) but the
// store update has already happened; we bump render once decoding completes.
function restorePixels(pixels: Record<string, string>, layers: Layer[]) {
  for (const [id, dataUrl] of Object.entries(pixels)) {
    const layer = layers.find((l) => l.id === id);
    const w = layer?.width ?? 1;
    const h = layer?.height ?? 1;
    loadImageFromSrc(dataUrl).then((img) => {
      const c = getLayerCanvas(id, w, h);
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      setLayerCanvas(id, c);
      useEditorStore.getState().bumpRender();
    });
  }
}
