import { create } from "zustand";

// Live cursor position in DOCUMENT space, updated on canvas pointer move.
// Kept in its own tiny store so rulers + status bar can subscribe without
// re-rendering the heavy CanvasStage on every mouse move.
interface PointerState {
  x: number | null;
  y: number | null;
  /** composited colour under the cursor (#rrggbb) for the status-bar readout */
  color: string | null;
  set: (x: number | null, y: number | null, color?: string | null) => void;
}

export const usePointerStore = create<PointerState>((set) => ({
  x: null,
  y: null,
  color: null,
  set: (x, y, color = null) => set({ x, y, color }),
}));
