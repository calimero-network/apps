import { create } from "zustand";
import type { MeshShape } from "./geometry";
import {
  cloneObject,
  defaultEnvironment,
  sameObject,
  type Environment,
  type SceneObject,
} from "./model";

export type Tool = "select" | "translate" | "rotate" | "scale";
export type Shading = "solid" | "material" | "wireframe";
export type Mode = "object" | "edit";
export type Role = "admin" | "editor" | "viewer";

export interface StoredMesh {
  shape: MeshShape;
  /** The contract's version stamp; 0 for a local edit not yet read back. */
  updated_at: number;
}

/**
 * One undoable change, as the writes it takes. A put replaces the whole object
 * (that is what the contract stores), a delete removes an object and its mesh,
 * and a mesh write replaces the vertices.
 */
export interface Change {
  puts: SceneObject[];
  deletes: string[];
  meshes: { id: string; shape: MeshShape }[];
}

export interface HistoryEntry {
  label: string;
  forward: Change;
  backward: Change;
}

/** Where committed changes go: the network outbox, registered by `useSceneSync`. */
export interface Outbox {
  send(change: Change): void;
}

/** What a gesture looked like before it started, so the end of a drag is one undo step. */
export interface Snapshot {
  objects: Map<string, SceneObject | undefined>;
  meshes: Map<string, MeshShape | undefined>;
}

const HISTORY_LIMIT = 100;

export const emptyChange = (): Change => ({ puts: [], deletes: [], meshes: [] });

export interface EditorState {
  objects: Map<string, SceneObject>;
  meshes: Map<string, StoredMesh>;
  environment: Environment;
  sceneName: string;
  /** Selected object ids, in the order they were picked; the last is active. */
  selection: string[];
  mode: Mode;
  /** Selected vertex indices of the active mesh, in edit mode. */
  vertexSelection: Set<number>;
  tool: Tool;
  space: "world" | "local";
  snap: boolean;
  shading: Shading;
  showGrid: boolean;
  ortho: boolean;
  /** The caller's role, as the contract reports it. */
  role: Role;
  me: string;
  /** True once the first read of the scene has landed. */
  loaded: boolean;
  /** A message for the status bar, with when it was set. */
  notice: { text: string; at: number; error?: boolean } | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  outbox: Outbox | null;

  // ── actions ──
  setOutbox(outbox: Outbox | null): void;
  select(ids: string[], mode?: "replace" | "add" | "toggle"): void;
  setTool(tool: Tool): void;
  setMode(mode: Mode): void;
  setVertexSelection(sel: Set<number>): void;
  set(partial: Partial<EditorState>): void;
  notify(text: string, error?: boolean): void;
  /** Show a change without recording or sending it — the frames of a drag. */
  preview(objects: SceneObject[], meshes?: { id: string; shape: MeshShape }[]): void;
  /** Capture the state a gesture is about to change. */
  snapshot(ids: string[], meshIds?: string[]): Snapshot;
  /** Apply a change, record it for undo, and send it. */
  commit(change: Change, label: string, before?: Snapshot): void;
  undo(): void;
  redo(): void;
  /** Fold a read from the node into the local model. */
  receive(read: {
    objects?: Map<string, SceneObject>;
    meshes?: Map<string, StoredMesh>;
    removedMeshes?: string[];
    environment?: Environment;
    sceneName?: string;
    role?: Role;
    me?: string;
  }): void;
  canEdit(): boolean;
}

function applyChange(
  objects: Map<string, SceneObject>,
  meshes: Map<string, StoredMesh>,
  change: Change,
): { objects: Map<string, SceneObject>; meshes: Map<string, StoredMesh> } {
  const nextObjects = new Map(objects);
  const nextMeshes = change.meshes.length || change.deletes.length ? new Map(meshes) : meshes;
  for (const id of change.deletes) {
    nextObjects.delete(id);
    nextMeshes.delete(id);
  }
  for (const o of change.puts) nextObjects.set(o.id, o);
  for (const m of change.meshes) nextMeshes.set(m.id, { shape: m.shape, updated_at: 0 });
  return { objects: nextObjects, meshes: nextMeshes };
}

/** The change that undoes `forward`, given the state before it. */
function inverse(forward: Change, before: Snapshot): Change {
  const back = emptyChange();
  const touched = new Set([...forward.puts.map((o) => o.id), ...forward.deletes]);
  for (const id of touched) {
    const prior = before.objects.get(id);
    if (prior) back.puts.push(prior);
    else back.deletes.push(id);
  }
  const meshIds = new Set([...forward.meshes.map((m) => m.id), ...forward.deletes]);
  for (const id of meshIds) {
    const prior = before.meshes.get(id);
    // A mesh that did not exist before needs no undo of its own: undoing the
    // object deletes it along with the object.
    if (prior) back.meshes.push({ id, shape: prior });
  }
  return back;
}

export const useEditor = create<EditorState>((set, get) => ({
  objects: new Map(),
  meshes: new Map(),
  environment: defaultEnvironment(),
  sceneName: "",
  selection: [],
  mode: "object",
  vertexSelection: new Set(),
  tool: "translate",
  space: "world",
  snap: false,
  shading: "solid",
  showGrid: true,
  ortho: false,
  role: "viewer",
  me: "",
  loaded: false,
  notice: null,
  past: [],
  future: [],
  outbox: null,

  setOutbox: (outbox) => set({ outbox }),

  select: (ids, mode = "replace") => {
    const { selection, objects } = get();
    const valid = ids.filter((id) => objects.has(id));
    let next: string[];
    if (mode === "replace") next = valid;
    else if (mode === "add") next = [...selection.filter((id) => !valid.includes(id)), ...valid];
    else {
      next = selection.slice();
      for (const id of valid) {
        const at = next.indexOf(id);
        if (at >= 0) next.splice(at, 1);
        else next.push(id);
      }
    }
    set({ selection: next });
    // Edit mode works on exactly one mesh; picking something else leaves it.
    if (get().mode === "edit" && next.at(-1) !== selection.at(-1)) {
      set({ mode: "object", vertexSelection: new Set() });
    }
  },

  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode, vertexSelection: new Set() }),
  setVertexSelection: (vertexSelection) => set({ vertexSelection }),
  set: (partial) => set(partial),
  notify: (text, error) => set({ notice: { text, at: Date.now(), error } }),

  preview: (objects, meshes = []) => {
    const state = get();
    const next = applyChange(state.objects, state.meshes, { puts: objects, deletes: [], meshes });
    set(next);
  },

  snapshot: (ids, meshIds = []) => {
    const { objects, meshes } = get();
    return {
      objects: new Map(ids.map((id) => [id, objects.has(id) ? cloneObject(objects.get(id)!) : undefined])),
      meshes: new Map(
        [...new Set([...meshIds, ...ids])].map((id) => [id, meshes.get(id)?.shape]),
      ),
    };
  },

  commit: (change, label, before) => {
    const state = get();
    if (!state.canEdit()) {
      state.notify("View only — ask the scene's admin for the editor role.", true);
      return;
    }
    // Writes that change nothing a person can see are dropped, so a click
    // that did not move anything is not an undo step or a transaction.
    const puts = change.puts.filter((o) => {
      const prior = before?.objects.get(o.id) ?? state.objects.get(o.id);
      return !prior || !sameObject(prior, o);
    });
    const effective: Change = { puts, deletes: change.deletes, meshes: change.meshes };
    if (!puts.length && !change.deletes.length && !change.meshes.length) return;
    const snap =
      before ??
      state.snapshot(
        [...puts.map((o) => o.id), ...change.deletes],
        change.meshes.map((m) => m.id),
      );
    const entry: HistoryEntry = { label, forward: effective, backward: inverse(effective, snap) };
    const applied = applyChange(state.objects, state.meshes, effective);
    const deleted = new Set(change.deletes);
    set({
      ...applied,
      selection: state.selection.filter((id) => !deleted.has(id)),
      past: [...state.past, entry].slice(-HISTORY_LIMIT),
      future: [],
    });
    state.outbox?.send(effective);
  },

  undo: () => {
    const state = get();
    const entry = state.past.at(-1);
    if (!entry || !state.canEdit()) return;
    const applied = applyChange(state.objects, state.meshes, entry.backward);
    set({
      ...applied,
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
      selection: state.selection.filter((id) => applied.objects.has(id)),
    });
    state.outbox?.send(entry.backward);
    state.notify(`Undo ${entry.label}`);
  },

  redo: () => {
    const state = get();
    const entry = state.future[0];
    if (!entry || !state.canEdit()) return;
    const applied = applyChange(state.objects, state.meshes, entry.forward);
    set({
      ...applied,
      past: [...state.past, entry],
      future: state.future.slice(1),
      selection: state.selection.filter((id) => applied.objects.has(id)),
    });
    state.outbox?.send(entry.forward);
    state.notify(`Redo ${entry.label}`);
  },

  receive: (read) => {
    const state = get();
    const patch: Partial<EditorState> = { loaded: true };
    if (read.objects) {
      patch.objects = read.objects;
      patch.selection = state.selection.filter((id) => read.objects!.has(id));
    }
    if (read.meshes || read.removedMeshes) {
      const meshes = new Map(state.meshes);
      for (const [id, m] of read.meshes ?? []) meshes.set(id, m);
      for (const id of read.removedMeshes ?? []) meshes.delete(id);
      patch.meshes = meshes;
    }
    if (read.environment) patch.environment = read.environment;
    if (read.sceneName !== undefined) patch.sceneName = read.sceneName;
    if (read.role) patch.role = read.role;
    if (read.me !== undefined) patch.me = read.me;
    set(patch);
    const after = get();
    if (after.mode === "edit") {
      const active = after.objects.get(after.selection.at(-1) ?? "");
      if (!active || active.kind !== "mesh") set({ mode: "object", vertexSelection: new Set() });
    }
  },

  canEdit: () => get().role !== "viewer",
}));

/** The active object: the last one selected. */
export function activeObject(state: Pick<EditorState, "objects" | "selection">): SceneObject | undefined {
  const id = state.selection.at(-1);
  return id ? state.objects.get(id) : undefined;
}
