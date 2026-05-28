import { create } from "zustand";
import type { Element } from "../types";

type Tool = "select" | "rect" | "circle" | "line" | "arrow" | "path" | "text" | "image";
export type Background = "#ffffff" | "#808080" | "#111111";

interface CanvasState {
  activeTool: Tool;
  selectedElementId: string | null;
  elements: Element[];
  background: Background;
  // keyed by element id — stores data URLs for Image/Svg elements (client-side only)
  imageCache: Record<string, string>;
  setTool: (tool: Tool) => void;
  selectElement: (id: string | null) => void;
  setElements: (elements: Element[]) => void;
  upsertElement: (element: Element) => void;
  removeElement: (id: string) => void;
  setBackground: (bg: Background) => void;
  cacheImage: (elementId: string, dataUrl: string) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeTool: "select",
  selectedElementId: null,
  elements: [],
  background: "#ffffff",
  imageCache: {},
  setTool: (tool) => set({ activeTool: tool, selectedElementId: null }),
  selectElement: (id) => set({ selectedElementId: id }),
  setElements: (elements) => set({ elements }),
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
}));
