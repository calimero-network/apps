import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Element } from "../types";
import {
  applyPlan, COALESCE_MS, isEmpty, plan, record,
  type HistoryEntry, type HistoryPlan,
} from "./history";

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
  /** This user's own actions, oldest first — see `store/history.ts`. */
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /**
   * Whether the newest undo entry still takes changes. `snapshot()`, undo and
   * redo close it, so the next local change starts a step of its own.
   */
  historyOpen: boolean;
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
  /** Replace the whole board, e.g. on load. Not an edit, so not undoable. */
  setElements: (elements: Element[]) => void;
  /**
   * A LOCAL edit: this user changed the element. Recorded for undo. A change
   * read back from the node (a teammate's, or this user's own echo) goes
   * through `applyRemoteElements` instead.
   */
  upsertElement: (element: Element) => void;
  /** `upsertElement` for a whole selection, as ONE store update (one canvas pass). */
  upsertElements: (elements: Element[]) => void;
  /** A LOCAL delete; recorded for undo. */
  removeElement: (id: string) => void;
  /** `removeElement` for a whole selection, as ONE store update. */
  removeElements: (ids: string[]) => void;
  /** Elements as the node now has them. Not recorded: they are not this user's edit. */
  applyRemoteElements: (elements: Element[]) => void;
  /** Elements the node says are gone. Not recorded. */
  removeRemoteElements: (ids: string[]) => void;
  setBackground: (bg: Background) => void;
  cacheImage: (elementId: string, dataUrl: string) => void;
  setPreviewMode: (v: boolean) => void;
  setElementLabel: (id: string, label: string) => void;
  setElementLabels: (labels: Record<string, string>) => void;
  toggleGroupCollapsed: (path: string) => void;
  startPresentation: (startId?: string | null) => void;
  stopPresentation: () => void;

  // History
  /** Mark the start of an undoable action: the next local change opens a new step. */
  snapshot: () => void;
  /**
   * Reverse this user's newest step in the store and say what to write to the
   * node to match (`api/history.ts` does both). `null` when there is nothing to undo.
   */
  undo: () => HistoryPlan | null;
  /** Re-apply the newest undone step; the counterpart of `undo`. */
  redo: () => HistoryPlan | null;

  // Clipboard
  copyElements: (els: Element[]) => void;
  /**
   * The elements to paste: fresh ids, nudged clear of the originals, stacked on
   * top in their original relative order. Empty when the clipboard is.
   */
  getPasted: () => Element[];
}

/** `incoming` written over `elements`: replaced in place, new ones appended in order. */
function upsert(elements: readonly Element[], incoming: readonly Element[]): Element[] {
  const byId = new Map(incoming.map((e) => [e.id, e] as const));
  const next = elements.map((e) => {
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
  return next;
}

/**
 * The history after a local edit that upserts `changed` and deletes `removed`,
 * read against the board BEFORE the edit. Joins the open step if there is one
 * and it took a change within `COALESCE_MS`; otherwise opens a new step, which
 * — as in every editor — forgets whatever was undone.
 */
function track(
  s: CanvasState,
  changed: readonly Element[],
  removed: readonly string[],
): Pick<CanvasState, "undoStack" | "redoStack" | "historyOpen"> {
  const now = Date.now();
  const top = s.undoStack[s.undoStack.length - 1];
  const joins = s.historyOpen && top !== undefined && now - top.at < COALESCE_MS;
  // A step that came to nothing (drawn, then deleted) is dropped, not kept as
  // an undo that does nothing.
  const kept = joins || !top || !isEmpty(top) ? s.undoStack : s.undoStack.slice(0, -1);
  let entry: HistoryEntry = joins ? top : { changes: {}, at: now };
  const byId = new Map(s.elements.map((e) => [e.id, e] as const));
  for (const el of changed) entry = record(entry, byId.get(el.id) ?? null, el, now);
  for (const id of removed) {
    const was = byId.get(id);
    if (was) entry = record(entry, was, null, now);
  }
  return {
    undoStack: joins ? [...kept.slice(0, -1), entry] : [...kept, entry].slice(-MAX_HISTORY),
    redoStack: joins ? s.redoStack : [],
    historyOpen: true,
  };
}

/** Undo or redo the newest non-empty step: apply it to the store, return what to write. */
function replay(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState>) => void,
  direction: "undo" | "redo",
): HistoryPlan | null {
  const s = get();
  const from = direction === "undo" ? [...s.undoStack] : [...s.redoStack];
  // Undo takes the newest step off the end; redo the most recently undone off the front.
  const take = () => (direction === "undo" ? from.pop() : from.shift());
  let entry = take();
  while (entry && isEmpty(entry)) entry = take();
  if (!entry) {
    set(direction === "undo" ? { undoStack: from, historyOpen: false } : { redoStack: from, historyOpen: false });
    return null;
  }
  const p = plan(entry, direction === "undo" ? "before" : "after", s.elements, Date.now());
  // A pending local rename would paint over the label the step puts back.
  const elementLabels = { ...s.elementLabels };
  for (const id of [...p.deletes, ...p.upserts.map((e) => e.id)]) delete elementLabels[id];
  set({
    elements: applyPlan(s.elements, p),
    elementLabels,
    historyOpen: false,
    ...(direction === "undo"
      ? { undoStack: from, redoStack: [entry, ...s.redoStack].slice(0, MAX_HISTORY) }
      : { redoStack: from, undoStack: [...s.undoStack, entry].slice(-MAX_HISTORY) }),
  });
  return p;
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
  historyOpen: false,
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
    set((s) => ({ elements: upsert(s.elements, [element]), ...track(s, [element], []) })),
  // Per element, a paste of N shapes was N store updates — N re-renders and N
  // canvas reconciles — each scanning the whole list: O(N²) before a single
  // request left. These do the whole selection in one pass.
  upsertElements: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return {};
      return { elements: upsert(s.elements, incoming), ...track(s, incoming, []) };
    }),
  removeElement: (id) =>
    set((s) => ({ elements: s.elements.filter((e) => e.id !== id), ...track(s, [], [id]) })),
  removeElements: (ids) =>
    set((s) => {
      if (ids.length === 0) return {};
      const gone = new Set(ids);
      return { elements: s.elements.filter((e) => !gone.has(e.id)), ...track(s, [], ids) };
    }),
  applyRemoteElements: (incoming) =>
    set((s) => (incoming.length === 0 ? {} : { elements: upsert(s.elements, incoming) })),
  removeRemoteElements: (ids) =>
    set((s) => {
      if (ids.length === 0) return {};
      const gone = new Set(ids);
      return { elements: s.elements.filter((e) => !gone.has(e.id)) };
    }),
  setBackground: (background) => set({ background }),
  cacheImage: (elementId, dataUrl) =>
    set((s) => ({ imageCache: { ...s.imageCache, [elementId]: dataUrl } })),
  setPreviewMode: (v) => set({ previewMode: v }),

  snapshot: () => set({ historyOpen: false }),

  undo: () => replay(get, set, "undo"),
  redo: () => replay(get, set, "redo"),

  setElementLabel: (id, label) =>
    set((s) => {
      // Keep the element itself in step: the canvas and every export read
      // `el.label`, so an override that only lived in the side table would show
      // in the layers tree and nowhere else.
      const elements = s.elements.map((e) => (e.id === id ? { ...e, label } : e));
      const renamed = elements.filter((e) => e.id === id);
      return { elementLabels: { ...s.elementLabels, [id]: label }, elements, ...track(s, renamed, []) };
    }),

  setElementLabels: (labels) =>
    set((s) => {
      const elements = s.elements.map((e) => (labels[e.id] !== undefined ? { ...e, label: labels[e.id] } : e));
      const renamed = elements.filter((e) => labels[e.id] !== undefined);
      return { elementLabels: { ...s.elementLabels, ...labels }, elements, ...track(s, renamed, []) };
    }),

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
