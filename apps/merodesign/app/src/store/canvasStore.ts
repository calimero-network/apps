import { create } from "zustand";
import type { Element } from "../types";

type Tool = "select" | "rect" | "circle" | "line" | "arrow" | "path" | "text" | "image";

interface CanvasState {
  activeTool: Tool;
  selectedElementId: string | null;
  elements: Element[];
  setTool: (tool: Tool) => void;
  selectElement: (id: string | null) => void;
  setElements: (elements: Element[]) => void;
  upsertElement: (element: Element) => void;
  removeElement: (id: string) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  activeTool: "select",
  selectedElementId: null,
  elements: [],
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
}));
