import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Element } from "../types";

/** How far a pasted batch sits from the one it was copied from. */
const PASTE_OFFSET = 20;

export type Tool =
  | "select" | "hand"
  | "rect" | "rounded" | "circle" | "triangle" | "diamond" | "star" | "cloud"
  | "line" | "arrow" | "path" | "text" | "sticky" | "image";
export type Background = "#ffffff" | "#808080" | "#111111";

const MAX_HISTORY = 50;

interface CanvasState {
  activeTool: Tool;
  selectedElementId: string | null;
  selectedElementIds: string[];
  elements: Element[];
  background: Background;
  imageCache: Record<string, string>;
  previewMode: boolean;
  undoStack: Element[][];
  redoStack: Element[][];
  /** Every copied element, in layer order. A copy is not one shape. */
  clipboard: Element[];
  /**
   * Local label overrides, applied on top of the contract's `label` so a rename
   * or a regroup shows instantly instead of after the RPC round-trips. Cleared
   * for an element once contract state agrees.
   */
  elementLabels: Record<string, string>;
  /** Group paths the layers tree is showing collapsed. */
  collapsedGroups: Record<string, boolean>;
  /**
   * Presentation mode. `null` when not presenting; otherwise the screen to open
   * on (`null` start = the first). Here rather than in CanvasPage because both
   * the toolbar and the Screens tab start it.
   */
  presentation: { startId: string | null } | null;
  /**
   * The box or sticky whose text is being typed into, if any. In the store so
   * the inspector's "Add text" and a double-click on the canvas open the same
   * editor.
   */
  editingTextId: string | null;

  setTool: (tool: Tool) => void;
  startTextEdit: (id: string) => void;
  stopTextEdit: () => void;
  /**
   * Hand control back to the pointer with `id` selected — what should happen
   * the moment an item is put down, and the moment an existing item is clicked
   * with a creation tool still held. `setTool` alone cannot express it: it
   * clears the selection, so calling it after `selectElement` would drop the
   * very item the user is now meant to be holding.
   */
  selectWithPointer: (id: string) => void;
  selectElement: (id: string | null) => void;
  selectElements: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  setElements: (elements: Element[]) => void;
  upsertElement: (element: Element) => void;
  /** `upsertElement` for a whole selection, as ONE store update (one canvas pass). */
  upsertElements: (elements: Element[]) => void;
  removeElement: (id: string) => void;
  /** `removeElement` for a whole selection, as ONE store update. */
  removeElements: (ids: string[]) => void;
  setBackground: (bg: Background) => void;
  cacheImage: (elementId: string, dataUrl: string) => void;
  setPreviewMode: (v: boolean) => void;
  setElementLabel: (id: string, label: string) => void;
  setElementLabels: (labels: Record<string, string>) => void;
  toggleGroupCollapsed: (path: string) => void;
  startPresentation: (startId?: string | null) => void;
  stopPresentation: () => void;

  // History
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Clipboard
  copyElements: (els: Element[]) => void;
  /**
   * The elements to paste: fresh ids, nudged clear of the originals, stacked on
   * top in their original relative order. Empty when the clipboard is.
   */
  getPasted: () => Element[];
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  activeTool: "select",
  selectedElementId: null,
  selectedElementIds: [],
  elements: [],
  background: "#ffffff",
  imageCache: {},
  previewMode: false,
  undoStack: [],
  redoStack: [],
  clipboard: [],
  elementLabels: {},
  collapsedGroups: {},
  presentation: null,
  editingTextId: null,

  startTextEdit: (id) => set({ editingTextId: id, activeTool: "select", selectedElementId: id, selectedElementIds: [id] }),
  stopTextEdit: () => set({ editingTextId: null }),
  setTool: (tool) => set({ activeTool: tool, selectedElementId: null, selectedElementIds: [] }),
  selectWithPointer: (id) => set({ activeTool: "select", selectedElementId: id, selectedElementIds: [id] }),
  selectElement: (id) => set({ selectedElementId: id, selectedElementIds: id ? [id] : [] }),
  selectElements: (ids) => set({ selectedElementIds: ids, selectedElementId: ids[0] ?? null }),
  toggleSelected: (id) =>
    set((s) => {
      const next = s.selectedElementIds.includes(id)
        ? s.selectedElementIds.filter((x) => x !== id)
        : [...s.selectedElementIds, id];
      return { selectedElementIds: next, selectedElementId: next[0] ?? null };
    }),
  setElements: (elements) =>
    set((s) => {
      const list = elements ?? [];
      // Drop local label overrides the contract has caught up with, so a stale
      // override cannot outlive a peer's rename of the same element.
      const overrides = { ...s.elementLabels };
      for (const el of list) {
        if (overrides[el.id] !== undefined && overrides[el.id] === (el.label ?? "")) {
          delete overrides[el.id];
        }
      }
      return { elements: list, elementLabels: overrides };
    }),
  upsertElement: (element) =>
    set((s) => {
      const idx = s.elements.findIndex((e) => e.id === element.id);
      if (idx >= 0) {
        const next = [...s.elements];
        next[idx] = element;
        return { elements: next };
      }
      return { elements: [...s.elements, element] };
    }),
  // Per element, a paste of N shapes was N store updates — N re-renders and N
  // canvas reconciles — each scanning the whole list: O(N²) before a single
  // request left. These do the whole selection in one pass.
  upsertElements: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return {};
      const byId = new Map(incoming.map((e) => [e.id, e] as const));
      const next = s.elements.map((e) => {
        const replacement = byId.get(e.id);
        if (!replacement) return e;
        byId.delete(e.id);
        return replacement;
      });
      // What is left in the map is new — appended in the order it came.
      // The map holds the LAST copy of each id, so a batch naming one twice
      // ends with its latest version.
      for (const e of incoming) {
        const latest = byId.get(e.id);
        if (latest) { next.push(latest); byId.delete(e.id); }
      }
      return { elements: next };
    }),
  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((e) => e.id !== id) })),
  removeElements: (ids) =>
    set((s) => {
      if (ids.length === 0) return {};
      const gone = new Set(ids);
      return { elements: s.elements.filter((e) => !gone.has(e.id)) };
    }),
  setBackground: (background) => set({ background }),
  cacheImage: (elementId, dataUrl) =>
    set((s) => ({ imageCache: { ...s.imageCache, [elementId]: dataUrl } })),
  setPreviewMode: (v) => set({ previewMode: v }),

  snapshot: () =>
    set((s) => ({
      undoStack: [...s.undoStack, s.elements.map((e) => ({ ...e }))].slice(-MAX_HISTORY),
      redoStack: [],
    })),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return {};
      const prev = s.undoStack[s.undoStack.length - 1];
      return {
        elements: prev.map((e) => ({ ...e })),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [s.elements.map((e) => ({ ...e })), ...s.redoStack].slice(0, MAX_HISTORY),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return {};
      const next = s.redoStack[0];
      return {
        elements: next.map((e) => ({ ...e })),
        redoStack: s.redoStack.slice(1),
        undoStack: [...s.undoStack, s.elements.map((e) => ({ ...e }))].slice(-MAX_HISTORY),
      };
    }),

  setElementLabel: (id, label) =>
    set((s) => ({
      elementLabels: { ...s.elementLabels, [id]: label },
      // Keep the element itself in step: the canvas and every export read
      // `el.label`, so an override that only lived in the side table would show
      // in the layers tree and nowhere else.
      elements: s.elements.map((e) => (e.id === id ? { ...e, label } : e)),
    })),

  setElementLabels: (labels) =>
    set((s) => ({
      elementLabels: { ...s.elementLabels, ...labels },
      elements: s.elements.map((e) => (labels[e.id] !== undefined ? { ...e, label: labels[e.id] } : e)),
    })),

  toggleGroupCollapsed: (path) =>
    set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [path]: !s.collapsedGroups[path] } })),

  startPresentation: (startId = null) => set({ presentation: { startId } }),
  stopPresentation: () => set({ presentation: null }),

  copyElements: (els) =>
    // Layer order, so a paste rebuilds the stack the way it was copied rather
    // than in whatever order the selection happened to be assembled.
    set({ clipboard: [...els].sort((a, b) => a.layerIndex - b.layerIndex).map((e) => ({ ...e })) }),

  getPasted: () => {
    const { clipboard, elements } = get();
    if (clipboard.length === 0) return [];
    const now = Date.now();
    // One offset for the whole batch, NOT per element: nudging each by 20
    // independently would preserve their spacing only by accident, and a
    // relative layout would drift apart on every paste.
    return clipboard.map((el, i) => ({
      ...el,
      id: uuid(),
      x: el.x + PASTE_OFFSET,
      y: el.y + PASTE_OFFSET,
      layerIndex: elements.length + i,
      createdAt: now,
      updatedAt: now,
    }));
  },
}));

// Dev-only handle for the perf bench (`e2e/perf/`), which has to drive a remote
// element update the way SSE does — from outside React — and time the repaint.
// `import.meta.env.DEV` is statically false in a production build, so the whole
// statement is dropped by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__canvasStore = useCanvasStore;
}
