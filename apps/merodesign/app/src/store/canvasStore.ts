import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Element } from "../types";

type Tool = "select" | "hand" | "rect" | "circle" | "line" | "arrow" | "path" | "text" | "image";
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
  clipboard: Element | null;
  /**
   * Local label overrides, applied on top of the contract's `label` so a rename
   * or a regroup shows instantly instead of after the RPC round-trips. Cleared
   * for an element once contract state agrees.
   */
  elementLabels: Record<string, string>;
  /** Group paths the layers tree is showing collapsed. */
  collapsedGroups: Record<string, boolean>;

  setTool: (tool: Tool) => void;
  selectElement: (id: string | null) => void;
  selectElements: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  setElements: (elements: Element[]) => void;
  upsertElement: (element: Element) => void;
  removeElement: (id: string) => void;
  setBackground: (bg: Background) => void;
  cacheImage: (elementId: string, dataUrl: string) => void;
  setPreviewMode: (v: boolean) => void;
  setElementLabel: (id: string, label: string) => void;
  setElementLabels: (labels: Record<string, string>) => void;
  toggleGroupCollapsed: (path: string) => void;

  // History
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Clipboard
  copyElement: (el: Element) => void;
  getPasted: () => Element | null;
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
  clipboard: null,
  elementLabels: {},
  collapsedGroups: {},

  setTool: (tool) => set({ activeTool: tool, selectedElementId: null, selectedElementIds: [] }),
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
  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((e) => e.id !== id) })),
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

  copyElement: (el) => set({ clipboard: { ...el } }),

  getPasted: () => {
    const { clipboard, elements } = get();
    if (!clipboard) return null;
    return {
      ...clipboard,
      id: uuid(),
      x: clipboard.x + 20,
      y: clipboard.y + 20,
      layerIndex: elements.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
}));

// Dev-only handle for the perf bench (`e2e/perf/`), which has to drive a remote
// element update the way SSE does — from outside React — and time the repaint.
// `import.meta.env.DEV` is statically false in a production build, so the whole
// statement is dropped by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__canvasStore = useCanvasStore;
}
