import { create } from "zustand";
import { shortAccount } from "@calimero-apps/names";
import type { MeshShape } from "./geometry";
import type { LockView, MeshRef, TextureRef } from "../generated/MeroModelsClient";
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
/** What a click picks in edit mode. */
export type SelectMode = "vertex" | "edge" | "face";

/** A number or a switch the last mesh tool can be re-run with, from the operator panel. */
export type OpParam =
  | { key: string; label: string; kind: "number"; min: number; max: number; step: number; integer?: boolean }
  | { key: string; label: string; kind: "toggle" }
  | { key: string; label: string; kind: "choice"; options: { value: number; label: string }[] };

/**
 * The mesh tool just run, which the operator panel can adjust: `rerun` runs
 * it again from the same starting mesh with new values. `final` false is a
 * preview while a slider moves; true replaces the history entry and saves.
 */
export interface LastOp {
  label: string;
  params: OpParam[];
  values: Record<string, number | boolean>;
  rerun(values: Record<string, number | boolean>, final: boolean): void;
}
export type Role = "admin" | "editor" | "viewer";

export interface StoredMesh {
  shape: MeshShape;
  /** The reference the shape was read from; null for a local edit not yet saved. */
  ref: MeshRef | null;
}

/**
 * One undoable change, as the writes it takes. A put replaces the whole object
 * (that is what the contract stores), a delete removes an object and its mesh,
 * and a mesh write replaces the vertices.
 */
export interface Change {
  puts: SceneObject[];
  deletes: string[];
  /** `message` is the version note the save carries into the history. */
  meshes: { id: string; shape: MeshShape; message?: string }[];
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
  /** Mesh references whose blob is still downloading, or failed to: id → message ("" while loading). */
  meshStatus: Map<string, string>;
  textures: Map<string, TextureRef>;
  /** Live check-outs, by asset id. */
  locks: Map<string, LockView>;
  /** Display names by member id, for check-outs and history. */
  memberNames: Map<string, string>;
  /**
   * The name a member set for the whole namespace, shared by every app on it:
   * the fallback for anyone who has not named themselves in this scene.
   */
  spaceNameOf: (id: string) => string | undefined;
  environment: Environment;
  sceneName: string;
  /** Selected object ids, in the order they were picked; the last is active. */
  selection: string[];
  mode: Mode;
  /**
   * Selected vertices of the active mesh's cage, in edit mode. In edge mode an
   * edge is selected when both its ends are; in face mode `faceSelection` is
   * what was picked and this follows it.
   */
  vertexSelection: Set<number>;
  /** Selected faces of the cage, in face mode. */
  faceSelection: Set<number>;
  selectMode: SelectMode;
  /** Edit-mode moves also move each vertex's mirror image across X. */
  xMirror: boolean;
  /** The 2D UV editor is open beside the 3D view. */
  uvEditor: boolean;
  /** Every mesh shows a UV checker instead of its colour, to judge stretch and seams. */
  uvChecker: boolean;
  /** The UV editor colours faces by how stretched their UVs are. */
  uvStretch: boolean;
  /** The texture size texel density is reported for. */
  uvTextureSize: number;
  lastOp: LastOp | null;
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
  /** Select faces (face mode), with the vertices they use. */
  setFaceSelection(faces: Set<number>, verts: Set<number>): void;
  setSelectMode(mode: SelectMode): void;
  set(partial: Partial<EditorState>): void;
  notify(text: string, error?: boolean): void;
  /** Show a change without recording or sending it — the frames of a drag. */
  preview(objects: SceneObject[], meshes?: { id: string; shape: MeshShape }[]): void;
  /** Capture the state a gesture is about to change. */
  snapshot(ids: string[], meshIds?: string[]): Snapshot;
  /** Apply a change, record it for undo, and send it. */
  commit(change: Change, label: string, before?: Snapshot): void;
  /** Replace what the last undo step did with `change` (the operator panel re-running a tool). */
  amend(change: Change, label: string): void;
  undo(): void;
  redo(): void;
  /** Fold a read from the node into the local model. */
  receive(read: {
    objects?: Map<string, SceneObject>;
    meshes?: Map<string, StoredMesh>;
    removedMeshes?: string[];
    meshStatus?: Map<string, string>;
    textures?: Map<string, TextureRef>;
    locks?: Map<string, LockView>;
    memberNames?: Map<string, string>;
    environment?: Environment;
    sceneName?: string;
    role?: Role;
    me?: string;
  }): void;
  canEdit(): boolean;
  /** The live check-out of `id` by someone else, if there is one. */
  lockedByOther(id: string): LockView | undefined;
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
  for (const m of change.meshes) nextMeshes.set(m.id, { shape: m.shape, ref: null });
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
  meshStatus: new Map(),
  textures: new Map(),
  locks: new Map(),
  memberNames: new Map(),
  spaceNameOf: () => undefined,
  environment: defaultEnvironment(),
  sceneName: "",
  selection: [],
  mode: "object",
  vertexSelection: new Set(),
  faceSelection: new Set(),
  selectMode: "vertex",
  xMirror: false,
  uvEditor: false,
  uvChecker: false,
  uvStretch: false,
  uvTextureSize: 2048,
  lastOp: null,
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
      set({ mode: "object", vertexSelection: new Set(), faceSelection: new Set(), lastOp: null });
    }
  },

  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode, vertexSelection: new Set(), faceSelection: new Set(), lastOp: null }),
  setVertexSelection: (vertexSelection) => set({ vertexSelection, faceSelection: new Set() }),
  setFaceSelection: (faceSelection, vertexSelection) => set({ faceSelection, vertexSelection }),
  setSelectMode: (selectMode) => set({ selectMode, faceSelection: new Set(), vertexSelection: get().selectMode === "face" ? new Set() : get().vertexSelection }),
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
    // Refused here, before anything moves on screen, rather than by the node a
    // round trip later.
    for (const id of [...puts.map((o) => o.id), ...change.deletes, ...change.meshes.map((m) => m.id)]) {
      const lock = state.lockedByOther(id);
      if (lock) {
        const name = state.objects.get(id)?.name ?? id;
        state.notify(`${name} is checked out by someone else — it is read-only until they check it in.`, true);
        // A refused drag has already been previewed; put it back.
        if (before) set(revert(state, before));
        return;
      }
    }
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
      lastOp: null,
    });
    state.outbox?.send(effective);
  },

  amend: (change, label) => {
    const state = get();
    const entry = state.past.at(-1);
    if (!entry || entry.label !== label || !state.canEdit()) return;
    // Back to where the entry started, then forward along the new change.
    const base = applyChange(state.objects, state.meshes, entry.backward);
    const applied = applyChange(base.objects, base.meshes, change);
    set({ ...applied, past: [...state.past.slice(0, -1), { ...entry, forward: change }], future: [] });
    state.outbox?.send(change);
  },

  undo: () => {
    const state = get();
    const entry = state.past.at(-1);
    if (!entry || !state.canEdit()) return;
    if (touches(entry.backward).some((id) => state.lockedByOther(id))) {
      state.notify(`Cannot undo ${entry.label}: something it changes is checked out by someone else.`, true);
      return;
    }
    const applied = applyChange(state.objects, state.meshes, entry.backward);
    set({
      ...applied,
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
      selection: state.selection.filter((id) => applied.objects.has(id)),
      vertexSelection: new Set(),
      faceSelection: new Set(),
      lastOp: null,
    });
    state.outbox?.send(entry.backward);
    state.notify(`Undo ${entry.label}`);
  },

  redo: () => {
    const state = get();
    const entry = state.future[0];
    if (!entry || !state.canEdit()) return;
    if (touches(entry.forward).some((id) => state.lockedByOther(id))) {
      state.notify(`Cannot redo ${entry.label}: something it changes is checked out by someone else.`, true);
      return;
    }
    const applied = applyChange(state.objects, state.meshes, entry.forward);
    set({
      ...applied,
      past: [...state.past, entry],
      future: state.future.slice(1),
      selection: state.selection.filter((id) => applied.objects.has(id)),
      vertexSelection: new Set(),
      faceSelection: new Set(),
      lastOp: null,
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
    if (read.meshStatus) patch.meshStatus = read.meshStatus;
    if (read.textures) patch.textures = read.textures;
    if (read.locks) patch.locks = read.locks;
    if (read.memberNames) patch.memberNames = read.memberNames;
    if (read.environment) patch.environment = read.environment;
    if (read.sceneName !== undefined) patch.sceneName = read.sceneName;
    if (read.role) patch.role = read.role;
    if (read.me !== undefined) patch.me = read.me;
    set(patch);
    const after = get();
    if (after.mode === "edit") {
      const active = after.objects.get(after.selection.at(-1) ?? "");
      if (!active || active.kind !== "mesh") set({ mode: "object", vertexSelection: new Set(), faceSelection: new Set(), lastOp: null });
    }
  },

  canEdit: () => get().role !== "viewer",

  lockedByOther: (id) => {
    const lock = get().locks.get(id);
    return lock && !lock.mine && lock.expires_at > Date.now() ? lock : undefined;
  },
}));

/** The objects and meshes a snapshot captured, put back as they were. */
function revert(state: EditorState, before: Snapshot): Pick<EditorState, "objects" | "meshes"> {
  const objects = new Map(state.objects);
  for (const [id, o] of before.objects) {
    if (o) objects.set(id, o);
    else objects.delete(id);
  }
  const meshes = new Map(state.meshes);
  for (const [id, shape] of before.meshes) {
    const stored = state.meshes.get(id);
    if (shape) meshes.set(id, { shape, ref: stored?.shape === shape ? stored.ref : null });
  }
  return { objects, meshes };
}

function touches(change: Change): string[] {
  return [...change.puts.map((o) => o.id), ...change.deletes, ...change.meshes.map((m) => m.id)];
}

/** The active object: the last one selected. */
export function activeObject(state: Pick<EditorState, "objects" | "selection">): SceneObject | undefined {
  const id = state.selection.at(-1);
  return id ? state.objects.get(id) : undefined;
}

/** What `useJoin` joins a member as when they have not named themselves. */
export const GUEST = "Guest";

/**
 * The name a member chose for this scene. `useJoin` joins an unnamed member as
 * "Guest", so that placeholder is no name: the namespace name is a better one.
 */
export function chosenName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed === GUEST ? "" : trimmed;
}

/** A member's scene name, else their namespace name, else a short form of their id. */
export function nameOf(state: Pick<EditorState, "memberNames" | "me" | "spaceNameOf">, id: string): string {
  if (id && id === state.me) return "you";
  if (!id) return "someone";
  return chosenName(state.memberNames.get(id)) || state.spaceNameOf(id) || shortAccount(id);
}
