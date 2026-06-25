import { create } from "zustand";

// Live cursor position in DOCUMENT space, updated on canvas pointer move.
// Kept in its own tiny store so rulers + status bar can subscribe without
// re-rendering the heavy CanvasStage on every mouse move.
interface PointerState {
  x: number | null;
  y: number | null;
  set: (x: number | null, y: number | null) => void;
}

export const usePointerStore = create<PointerState>((set) => ({
  x: null,
  y: null,
  set: (x, y) => set({ x, y }),
}));
