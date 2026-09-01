import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  BrushType, DocumentInfo, GradientFill, GradientType, Guide, Layer, PanelId,
  Role, Selection, ShapeKind, Tool, TransformMode, Unit,
} from "../types";
import { snapshotLayerCanvas, setLayerCanvas, getLayerCanvas } from "./layerCanvases";
import { ctx2d, loadImageFromSrc } from "../utils/raster";
import { expandSelection } from "../utils/layerTree";

/**
 * Fill in transform fields a layer may arrive without.
 *
 * `skewX`/`skewY`/`flipH`/`flipV`/`warp` were added to the contract after the
 * first release, and `#[serde(default)]` means an older stored layer simply
 * omits them. Every layer entering the store goes through here so the rest of
 * the app can treat them as always-present numbers rather than sprinkling `?? 0`
 * across the compositor and the gizmo.
 */
export function normalizeLayer(l: Layer): Layer {
  if (
    typeof l.skewX === "number" && typeof l.skewY === "number"
    && typeof l.flipH === "boolean" && typeof l.flipV === "boolean"
  ) return l;
  return {
    ...l,
    skewX: l.skewX ?? 0,
    skewY: l.skewY ?? 0,
    flipH: l.flipH ?? false,
    flipV: l.flipV ?? false,
    warp: l.warp ?? "",
  };
}

const MAX_HISTORY = 40;

/**
 * Which dock panels start collapsed to just their header.
 *
 * Transform and History are closed on purpose: five expanded panels push the
 * Layers panel — the one people actually live in — below the fold on a 1000px-tall
 * window. The canvas gizmo is the primary way to transform something, and
 * Edit ▸ Transform Numerically… opens the panel when exact values are wanted.
 *
 * Exported so the test suite asserts the documented default rather than whatever
 * a previous test left in this module-level store.
 */
export const DEFAULT_PANEL_COLLAPSED: Record<PanelId, boolean> = {
  navigator: false, adjustments: false, transform: true, history: true, layers: false,
};

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
  selectedLayerId: string | null;     // "primary" selection (props/adjustments/paint target)
  selectedLayerIds: string[];         // full multi-selection (move/transform/delete together)
  editingMaskOf: string | null; // layer id whose mask is being painted, or null
  editingTextId: string | null; // text layer being edited inline, or null

  activeTool: Tool;
  /** Which gizmo the Transform tool shows (scale/rotate box vs. warp pins). */
  transformMode: TransformMode;
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
  /** which dockable right-rail panels are visible (Window menu) */
  panels: Record<PanelId, boolean>;
  /** which visible panels are collapsed to just their header */
  panelCollapsed: Record<PanelId, boolean>;
  /** folder rows collapsed in the layers panel — view state, per user, so it is
   *  deliberately NOT contract state (two people can browse the same document
   *  with different folders open) */
  collapsedGroups: Record<string, boolean>;

  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // ── setters ──
  setDoc: (doc: DocumentInfo | null) => void;
  setLayers: (layers: Layer[]) => void;
  upsertLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  selectLayer: (id: string | null) => void;
  /** Replace the multi-selection (primary = last id). */
  setSelectedLayers: (ids: string[]) => void;
  /** Add/remove a layer from the multi-selection (Cmd/Ctrl-click). */
  toggleLayerSelection: (id: string) => void;
  /** Select a folder plus everything inside it (the panel's folder rows). */
  selectSubtree: (id: string) => void;
  setEditingMask: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setTransformMode: (m: TransformMode) => void;
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
  togglePanelCollapsed: (id: PanelId) => void;
  toggleGroupCollapsed: (id: string) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
  /** Collapse/expand every folder at once (the panel header's chevron). */
  setAllGroupsCollapsed: (collapsed: boolean) => void;

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
  selectedLayerIds: [],
  editingMaskOf: null,
  editingTextId: null,

  activeTool: "move",
  transformMode: "free",
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
  panels: { navigator: true, adjustments: true, transform: true, history: true, layers: true },
  panelCollapsed: { ...DEFAULT_PANEL_COLLAPSED },
  collapsedGroups: {},

  undoStack: [],
  redoStack: [],

  setDoc: (doc) => set({ doc }),

  setLayers: (layers) =>
    set({ layers: [...layers].map(normalizeLayer).sort((a, b) => a.layerIndex - b.layerIndex) }),

  upsertLayer: (raw) =>
    set((s) => {
      const layer = normalizeLayer(raw);
      const idx = s.layers.findIndex((l) => l.id === layer.id);
      const next = idx >= 0
        ? s.layers.map((l) => (l.id === layer.id ? layer : l))
        : [...s.layers, layer];
      next.sort((a, b) => a.layerIndex - b.layerIndex);
      return { layers: next };
    }),

  removeLayer: (id) =>
    set((s) => {
      const ids = s.selectedLayerIds.filter((x) => x !== id);
      return {
        layers: s.layers.filter((l) => l.id !== id),
        selectedLayerId: s.selectedLayerId === id ? (ids[ids.length - 1] ?? null) : s.selectedLayerId,
        selectedLayerIds: ids,
      };
    }),

  // Selecting a folder selects its contents too (see utils/layerTree —
  // `expandSelection` keeps the folder itself last, so it stays the primary
  // layer whose properties the panels show).
  selectLayer: (id) =>
    set((s) => ({
      selectedLayerId: id,
      selectedLayerIds: id ? expandSelection(s.layers, [id]) : [],
      editingMaskOf: null,
      editingTextId: null,
    })),

  selectSubtree: (id) =>
    set((s) => ({
      selectedLayerId: id,
      selectedLayerIds: expandSelection(s.layers, [id]),
      editingMaskOf: null,
      editingTextId: null,
    })),

  setSelectedLayers: (ids) =>
    set((s) => ({
      selectedLayerIds: expandSelection(s.layers, ids),
      selectedLayerId: ids[ids.length - 1] ?? null,
      editingMaskOf: null,
      editingTextId: null,
    })),

  toggleLayerSelection: (id) =>
    set((s) => {
      const has = s.selectedLayerIds.includes(id);
      // Removing a folder from the selection removes its contents with it.
      const drop = new Set(has ? expandSelection(s.layers, [id]) : []);
      const ids = has
        ? s.selectedLayerIds.filter((x) => !drop.has(x))
        : expandSelection(s.layers, [...s.selectedLayerIds, id]);
      return {
        selectedLayerIds: ids,
        selectedLayerId: has ? (ids[ids.length - 1] ?? null) : id,
        editingMaskOf: null,
        editingTextId: null,
      };
    }),
  setEditingMask: (id) => set({ editingMaskOf: id }),
  setEditingText: (id) => set({ editingTextId: id }),
  setTool: (t) => set({ activeTool: t }),
  setTransformMode: (transformMode) => set({ transformMode }),
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
  togglePanelCollapsed: (id) => set((s) => ({ panelCollapsed: { ...s.panelCollapsed, [id]: !s.panelCollapsed[id] } })),
  toggleGroupCollapsed: (id) =>
    set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] } })),
  setGroupCollapsed: (id, collapsed) =>
    set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [id]: collapsed } })),
  setAllGroupsCollapsed: (collapsed) =>
    set((s) => {
      const next: Record<string, boolean> = {};
      for (const l of s.layers) if (l.kind === "group") next[l.id] = collapsed;
      return { collapsedGroups: next };
    }),

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
