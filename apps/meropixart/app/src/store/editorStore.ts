import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  BrushType, DocumentInfo, GradientFill, GradientType, Guide, Layer, PanelId,
  Role, Selection, ShapeKind, Tool, Unit,
} from "../types";
import { snapshotLayerCanvas, setLayerCanvas, getLayerCanvas } from "./layerCanvases";
import { ctx2d, loadImageFromSrc } from "../utils/raster";

const MAX_HISTORY = 40;

// A history entry captures the layers metadata plus a pixel snapshot (dataURL)
// of any layer canvases that the operation is about to mutate.
interface HistoryEntry {
  doc: DocumentInfo | null; // doc size, so crop (resize + layer reposition) is undoable
  layers: Layer[];
  pixels: Record<string, string>; // layerId -> dataURL
  selectedLayerId: string | null;
  label: string; // human-readable name surfaced in the History panel
}

export interface ViewSettings {
  showGrid: boolean;
  gridSize: number;       // doc-space px between grid lines
  showGuides: boolean;
  snap: boolean;          // snap moves to grid / guides / edges
  showCrosshair: boolean; // Photoshop-style cursor crosshair across the canvas
  units: Unit;
  checkerSize: number;    // transparency checkerboard square size (px)
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
  /** Copied/cut selection pixels (doc-space top-left at x/y), pasted as a new layer. */
  clipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null;

  myRole: Role;
  /** show the precision rulers around the canvas */
  showRulers: boolean;
  /** bump to force the compositor to redraw (after imperative pixel mutations) */
  renderTick: number;

  // ── view (grid / guides / units) ──
  view: ViewSettings;
  guides: Guide[];
  /** which dockable right-rail panels are visible */
  panels: Record<PanelId, boolean>;

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
  setClipboard: (c: { canvas: HTMLCanvasElement; x: number; y: number } | null) => void;
  setRole: (r: Role) => void;
  toggleRulers: () => void;
  bumpRender: () => void;

  // ── view / guides / panels ──
  setView: (patch: Partial<ViewSettings>) => void;
  addGuide: (orient: "h" | "v", pos: number) => void;
  moveGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;
  togglePanel: (id: PanelId) => void;

  // ── history ──
  pushHistory: (affectedLayerIds: string[], label?: string) => void;
  undo: () => void;
  redo: () => void;
  jumpHistory: (targetUndoLength: number) => void;
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
  clipboard: null,

  myRole: "viewer",
  showRulers: true,
  renderTick: 0,

  view: {
    showGrid: false,
    gridSize: 50,
    showGuides: true,
    snap: true,
    showCrosshair: false,
    units: "px",
    checkerSize: 8,
  },
  guides: [],
  panels: { navigator: true, adjustments: true, history: true, layers: true },

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

  selectLayer: (id) => set({ selectedLayerId: id, editingMaskOf: null, editingTextId: null }),
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
  setClipboard: (clipboard) => set({ clipboard }),
  setRole: (r) => set({ myRole: r }),
  toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  bumpRender: () => set((s) => ({ renderTick: s.renderTick + 1 })),

  // ── view / guides / panels ──
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  addGuide: (orient, pos) =>
    set((s) => ({ guides: [...s.guides, { id: uuid(), orient, pos: Math.round(pos) }] })),
  moveGuide: (id, pos) =>
    set((s) => ({ guides: s.guides.map((g) => (g.id === id ? { ...g, pos: Math.round(pos) } : g)) })),
  removeGuide: (id) => set((s) => ({ guides: s.guides.filter((g) => g.id !== id) })),
  clearGuides: () => set({ guides: [] }),
  togglePanel: (id) => set((s) => ({ panels: { ...s.panels, [id]: !s.panels[id] } })),

  pushHistory: (affectedLayerIds, label = "Edit") =>
    set((s) => {
      const pixels: Record<string, string> = {};
      for (const id of affectedLayerIds) {
        const snap = snapshotLayerCanvas(id);
        if (snap) pixels[id] = snap;
      }
      const entry: HistoryEntry = {
        doc: s.doc ? { ...s.doc } : null,
        layers: s.layers.map((l) => ({ ...l })),
        pixels,
        selectedLayerId: s.selectedLayerId,
        label,
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
      doc: s.doc ? { ...s.doc } : null,
      layers: s.layers.map((l) => ({ ...l })),
      pixels: redoPixels,
      selectedLayerId: s.selectedLayerId,
      label: entry.label,
    };
    restorePixels(entry.pixels, entry.layers);
    set({
      doc: entry.doc,
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
      doc: s.doc ? { ...s.doc } : null,
      layers: s.layers.map((l) => ({ ...l })),
      pixels: undoPixels,
      selectedLayerId: s.selectedLayerId,
      label: entry.label,
    };
    restorePixels(entry.pixels, entry.layers);
    set({
      doc: entry.doc,
      layers: entry.layers,
      selectedLayerId: entry.selectedLayerId,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, undoEntry].slice(-MAX_HISTORY),
      renderTick: s.renderTick + 1,
    });
  },

  // Step the history pointer to a target depth (undoStack length). Used by the
  // History panel to jump to a clicked state. Sequential undo/redo keeps the
  // redo/undo chains intact; restorePixels' sequence guard prevents stale async
  // decodes from clobbering the final state.
  jumpHistory: (targetUndoLength) => {
    const clamp = Math.max(0, targetUndoLength);
    let guard = 0;
    while (get().undoStack.length > clamp && guard++ < MAX_HISTORY * 2) get().undo();
    while (get().undoStack.length < clamp && get().redoStack.length > 0 && guard++ < MAX_HISTORY * 2) get().redo();
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

// Per-layer monotonic token: when jumpHistory fires several undo/redo steps in
// a row, multiple async image decodes for the SAME layer may be in flight. We
// only apply the most recently *requested* restore for each layer so the final
// pixels match the final metadata state (no out-of-order clobbering).
const restoreSeq = new Map<string, number>();

// Restore pixel snapshots onto layer canvases. Async (image decode) but the
// store update has already happened; we bump render once decoding completes.
function restorePixels(pixels: Record<string, string>, layers: Layer[]) {
  for (const [id, dataUrl] of Object.entries(pixels)) {
    const layer = layers.find((l) => l.id === id);
    const w = layer?.width ?? 1;
    const h = layer?.height ?? 1;
    const token = (restoreSeq.get(id) ?? 0) + 1;
    restoreSeq.set(id, token);
    loadImageFromSrc(dataUrl).then((img) => {
      if (restoreSeq.get(id) !== token) return; // a newer restore superseded this one
      const c = getLayerCanvas(id, w, h);
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      setLayerCanvas(id, c);
      useEditorStore.getState().bumpRender();
    });
  }
}
