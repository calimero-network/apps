import * as THREE from "three";
import {
  decimate,
  deleteVertices,
  extrudeRegion,
  fitsLimits,
  flipNormals,
  joinShapes,
  mergeByDistance,
  primitiveGeometry,
  shapeCenter,
  shapeFromGeometry,
  smooth,
  subdivide,
  transformShape,
  triangleCount,
  vertexCount,
  type MeshShape,
} from "./geometry";
import {
  MAX_OBJECTS,
  MAX_TRIANGLES,
  MAX_VERTICES,
  childrenIndex,
  cloneObject,
  descendants,
  isSolid,
  makeObject,
  newId,
  resolvedParent,
  topmost,
  uniqueName,
  vec,
  wouldLoop,
  type ObjectKind,
  type SceneObject,
} from "./model";
import { activeObject, emptyChange, useEditor, type Change } from "./store";
import { localMatrix, reparent, withMatrix, worldMatrix } from "./transform";

/** What commands need from the 3D view: where to put things and how big things are. */
export interface ViewHandle {
  cursor(): THREE.Vector3;
  worldBox(id: string): THREE.Box3 | null;
  frameSelection(selectionOnly?: boolean): void;
}

let view: ViewHandle | null = null;

export function setViewHandle(handle: ViewHandle | null): void {
  view = handle;
}

const editor = () => useEditor.getState();

function names(): string[] {
  return [...editor().objects.values()].map((o) => o.name);
}

function guard(): boolean {
  const s = editor();
  if (!s.canEdit()) {
    s.notify("View only — ask the scene's admin for the editor role.", true);
    return false;
  }
  return true;
}

function roomFor(count: number): boolean {
  if (editor().objects.size + count > MAX_OBJECTS) {
    editor().notify(`A scene holds at most ${MAX_OBJECTS} objects.`, true);
    return false;
  }
  return true;
}

/** The shape a solid object draws, in its own space: its mesh, or its primitive's. */
export function shapeOf(o: SceneObject): MeshShape | null {
  if (o.kind === "mesh") return editor().meshes.get(o.id)?.shape ?? null;
  const g = primitiveGeometry(o.kind, o.segments);
  if (!g) return null;
  const shape = shapeFromGeometry(g);
  g.dispose();
  return shape;
}

function checkLimits(shape: MeshShape, what: string): boolean {
  if (fitsLimits(shape)) return true;
  editor().notify(
    `${what} would have ${vertexCount(shape).toLocaleString()} vertices and ${triangleCount(shape).toLocaleString()} triangles; a mesh holds at most ${MAX_VERTICES.toLocaleString()} and ${MAX_TRIANGLES.toLocaleString()}.`,
    true,
  );
  return false;
}

// ── Adding ──────────────────────────────────────────────────────────────────

export function addObject(kind: ObjectKind): void {
  if (!guard() || !roomFor(1)) return;
  const at = view?.cursor() ?? new THREE.Vector3();
  const obj = makeObject(kind, names(), vec(at.x, at.y, at.z));
  editor().commit({ puts: [obj], deletes: [], meshes: [] }, `Add ${obj.name}`);
  editor().select([obj.id]);
  editor().setMode("object");
}

/** Copies of the selection (with their children), offset so they do not sit on the originals. */
export function duplicateSelection(offset = new THREE.Vector3(0.5, 0, 0.5)): void {
  if (!guard()) return;
  const s = editor();
  const roots = topmost(s.selection, s.objects);
  if (!roots.length) return;
  const ids = roots.flatMap((id) => descendants(id, s.objects));
  if (!roomFor(ids.length)) return;
  const { change, ids: remap } = copies(ids, roots, offset);
  s.commit(change, "Duplicate");
  s.select(roots.map((id) => remap.get(id)!));
}

/** Fresh copies of `ids`; parents inside the set are remapped, `roots` are offset in world space. */
function copies(ids: string[], roots: string[], offset: THREE.Vector3): { change: Change; ids: Map<string, string> } {
  const s = editor();
  const remap = new Map(ids.map((id) => [id, newId()]));
  const taken = names();
  const change = emptyChange();
  for (const id of ids) {
    const o = s.objects.get(id)!;
    let copy = cloneObject(o);
    copy.id = remap.get(id)!;
    copy.name = uniqueName(o.name, taken);
    taken.push(copy.name);
    const parent = resolvedParent(o, s.objects);
    copy.parent = remap.get(parent) ?? parent;
    copy.created_at = 0;
    copy.updated_at = 0;
    if (roots.includes(id)) {
      const world = worldMatrix(id, s.objects).premultiply(new THREE.Matrix4().makeTranslation(offset));
      const parentWorld = parent ? worldMatrix(parent, s.objects) : new THREE.Matrix4();
      copy = withMatrix(copy, parentWorld.invert().multiply(world));
    }
    change.puts.push(copy);
    const mesh = s.meshes.get(id);
    if (mesh) change.meshes.push({ id: copy.id, shape: mesh.shape });
  }
  return { change, ids: remap };
}

/** `count` copies of the selection, each `step` further along. */
export function arraySelection(count: number, step: THREE.Vector3): void {
  if (!guard()) return;
  const s = editor();
  const roots = topmost(s.selection, s.objects);
  if (!roots.length || count < 1) return;
  const ids = roots.flatMap((id) => descendants(id, s.objects));
  if (!roomFor(ids.length * count)) return;
  const all: Change = emptyChange();
  for (let i = 1; i <= count; i += 1) {
    const { change } = copies(ids, roots, step.clone().multiplyScalar(i));
    all.puts.push(...change.puts);
    all.meshes.push(...change.meshes);
  }
  s.commit(all, `Array ×${count}`);
}

// ── Removing, hiding, selecting ─────────────────────────────────────────────

export function deleteSelection(): void {
  if (!guard()) return;
  const s = editor();
  if (s.mode === "edit") return deleteSelectedVertices();
  if (!s.selection.length) return;
  // A deleted object takes its children with it, as in the outliner.
  const ids = [...new Set(topmost(s.selection, s.objects).flatMap((id) => descendants(id, s.objects)))];
  s.commit({ puts: [], deletes: ids, meshes: [] }, ids.length === 1 ? `Delete ${s.objects.get(ids[0]!)?.name}` : `Delete ${ids.length} objects`);
}

export function setVisible(ids: string[], visible: boolean): void {
  if (!guard()) return;
  const s = editor();
  const puts = ids
    .map((id) => s.objects.get(id))
    .filter((o): o is SceneObject => !!o && o.visible !== visible)
    .map((o) => ({ ...cloneObject(o), visible }));
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, visible ? "Show" : "Hide");
}

export function hideSelection(): void {
  setVisible(editor().selection, false);
  editor().select([]);
}

export function unhideAll(): void {
  setVisible([...editor().objects.keys()], true);
}

export function selectAll(): void {
  const s = editor();
  if (s.mode === "edit") {
    const target = activeObject(s);
    const shape = target ? s.meshes.get(target.id)?.shape : undefined;
    if (!shape) return;
    const all = shape.positions.length / 3;
    s.setVertexSelection(s.vertexSelection.size === all ? new Set() : new Set(Array.from({ length: all }, (_, i) => i)));
    return;
  }
  s.select([...s.objects.values()].filter((o) => o.visible).map((o) => o.id));
}

export function invertSelection(): void {
  const s = editor();
  if (s.mode === "edit") {
    const target = activeObject(s);
    const shape = target ? s.meshes.get(target.id)?.shape : undefined;
    if (!shape) return;
    const next = new Set<number>();
    for (let i = 0; i < shape.positions.length / 3; i += 1) if (!s.vertexSelection.has(i)) next.add(i);
    s.setVertexSelection(next);
    return;
  }
  const chosen = new Set(s.selection);
  s.select([...s.objects.values()].filter((o) => o.visible && !chosen.has(o.id)).map((o) => o.id));
}

export function deselect(): void {
  const s = editor();
  if (s.mode === "edit") s.setVertexSelection(new Set());
  else s.select([]);
}

// ── Hierarchy ───────────────────────────────────────────────────────────────

/** Move objects under `parent` (`""` for the root), keeping them where they are on screen. */
export function setParent(ids: string[], parent: string, label = "Parent"): void {
  if (!guard()) return;
  const s = editor();
  const puts: SceneObject[] = [];
  for (const id of topmost(ids, s.objects)) {
    if (id === parent) continue;
    if (wouldLoop(id, parent, s.objects)) {
      s.notify("An object cannot go inside its own child.", true);
      return;
    }
    if (resolvedParent(s.objects.get(id)!, s.objects) === parent) continue;
    const next = reparent(id, parent, s.objects);
    if (next) puts.push(next);
  }
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, label);
}

/** Ctrl+P: everything selected goes under the active object. */
export function parentToActive(): void {
  const s = editor();
  const active = activeObject(s);
  if (!active || s.selection.length < 2) {
    s.notify("Select the children, then the new parent last.", true);
    return;
  }
  setParent(s.selection.filter((id) => id !== active.id), active.id, "Parent to active");
}

export function clearParent(): void {
  setParent(editor().selection, "", "Clear parent");
}

/** Ctrl+G: a new empty at the selection's centre, holding the selection. */
export function groupSelection(): void {
  if (!guard() || !roomFor(1)) return;
  const s = editor();
  const roots = topmost(s.selection, s.objects);
  if (!roots.length) return;
  const center = new THREE.Vector3();
  for (const id of roots) center.add(new THREE.Vector3().setFromMatrixPosition(worldMatrix(id, s.objects)));
  center.divideScalar(roots.length);
  // The group joins the hierarchy where the first selected object was.
  const parent = resolvedParent(s.objects.get(roots[0]!)!, s.objects);
  const group = makeObject("group", names());
  group.name = uniqueName("Group", names());
  group.parent = parent;
  const parentWorld = parent ? worldMatrix(parent, s.objects) : new THREE.Matrix4();
  const local = parentWorld.clone().invert().multiply(new THREE.Matrix4().makeTranslation(center));
  const placed = withMatrix(group, local);
  const withGroup = new Map(s.objects);
  withGroup.set(placed.id, placed);
  const moved = roots.map((id) => reparent(id, placed.id, withGroup)!).filter(Boolean);
  s.commit({ puts: [placed, ...moved], deletes: [], meshes: [] }, "Group");
  s.select([placed.id]);
}

/** Dissolve selected empties: their children move up a level, in place. */
export function ungroupSelection(): void {
  if (!guard()) return;
  const s = editor();
  const groups = s.selection.map((id) => s.objects.get(id)).filter((o): o is SceneObject => o?.kind === "group");
  if (!groups.length) {
    s.notify("Select an empty (group) to ungroup.", true);
    return;
  }
  const index = childrenIndex(s.objects);
  const puts: SceneObject[] = [];
  const freed: string[] = [];
  for (const g of groups) {
    const up = resolvedParent(g, s.objects);
    for (const child of index.get(g.id) ?? []) {
      const next = reparent(child.id, up, s.objects);
      if (next) {
        puts.push(next);
        freed.push(child.id);
      }
    }
  }
  s.commit({ puts, deletes: groups.map((g) => g.id), meshes: [] }, "Ungroup");
  s.select(freed);
}

// ── Mesh operations (object mode) ───────────────────────────────────────────

function solidsInSelection(): SceneObject[] {
  const s = editor();
  return s.selection.map((id) => s.objects.get(id)).filter((o): o is SceneObject => !!o && isSolid(o.kind));
}

/** Turn primitives into editable meshes, in place. */
export function convertToMesh(ids = editor().selection): string[] {
  if (!guard()) return [];
  const s = editor();
  const change = emptyChange();
  for (const id of ids) {
    const o = s.objects.get(id);
    if (!o || !isSolid(o.kind) || o.kind === "mesh") continue;
    const shape = shapeOf(o);
    if (!shape) continue;
    change.puts.push({ ...cloneObject(o), kind: "mesh" });
    change.meshes.push({ id, shape });
  }
  if (change.puts.length) s.commit(change, "Convert to mesh");
  return change.puts.map((o) => o.id);
}

/** Replace each selected solid's shape with `op(shape)`, converting primitives first. */
function reshape(label: string, op: (shape: MeshShape, o: SceneObject) => MeshShape | null): void {
  if (!guard()) return;
  const s = editor();
  const targets = solidsInSelection();
  if (!targets.length) {
    s.notify("Select a mesh or a primitive first.", true);
    return;
  }
  const change = emptyChange();
  for (const o of targets) {
    const shape = shapeOf(o);
    if (!shape) continue;
    const next = op(shape, o);
    if (!next || !checkLimits(next, `${o.name}`)) return;
    if (o.kind !== "mesh") change.puts.push({ ...cloneObject(o), kind: "mesh" });
    change.meshes.push({ id: o.id, shape: next });
  }
  s.commit(change, label);
}

export const subdivideSelection = () => reshape("Subdivide", (shape) => subdivide(shape));
export const smoothSelection = () => reshape("Smooth", (shape) => smooth(shape, 0.5, 2));
export const flipSelection = () => reshape("Flip normals", (shape) => flipNormals(shape));
export const mergeSelection = () => reshape("Merge by distance", (shape) => mergeByDistance(shape, 1e-3));
export const decimateSelection = () =>
  reshape("Decimate", (shape) => decimate(shape, Math.max(4, Math.floor(vertexCount(shape) / 2))));

/**
 * Ctrl+A, apply transforms: bake the object's rotation and scale into its
 * vertices, leaving the transform at identity rotation and unit scale. The
 * object stays exactly where it is, and so do its children.
 */
export function applyTransforms(): void {
  if (!guard()) return;
  const s = editor();
  const targets = solidsInSelection();
  if (!targets.length) return;
  const change = emptyChange();
  const index = childrenIndex(s.objects);
  for (const o of targets) {
    const shape = shapeOf(o);
    if (!shape) continue;
    const rs = new THREE.Matrix4().compose(
      new THREE.Vector3(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation.x, o.rotation.y, o.rotation.z, "XYZ")),
      new THREE.Vector3(o.scale.x, o.scale.y, o.scale.z),
    );
    const next = { ...cloneObject(o), kind: "mesh", rotation: vec(), scale: vec(1, 1, 1) };
    change.puts.push(next);
    change.meshes.push({ id: o.id, shape: transformShape(shape, rs) });
    // Children were under the old rotation and scale; carry them over so they do not move.
    for (const child of index.get(o.id) ?? []) {
      change.puts.push(withMatrix(child, rs.clone().multiply(localMatrix(child))));
    }
  }
  s.commit(change, "Apply transforms");
}

/** Move each object's origin to the centre of its geometry, without moving the geometry. */
export function originToGeometry(): void {
  if (!guard()) return;
  const s = editor();
  const change = emptyChange();
  const index = childrenIndex(s.objects);
  for (const o of solidsInSelection()) {
    const shape = shapeOf(o);
    if (!shape) continue;
    const c = shapeCenter(shape);
    if (c.lengthSq() < 1e-12) continue;
    const shift = new THREE.Matrix4().makeTranslation(c);
    const next = withMatrix({ ...cloneObject(o), kind: "mesh" }, localMatrix(o).multiply(shift));
    change.puts.push(next);
    change.meshes.push({ id: o.id, shape: transformShape(shape, new THREE.Matrix4().makeTranslation(c.clone().negate())) });
    const back = shift.clone().invert();
    for (const child of index.get(o.id) ?? []) change.puts.push(withMatrix(child, back.clone().multiply(localMatrix(child))));
  }
  if (change.puts.length) s.commit(change, "Origin to geometry");
}

/** Mirror across the object's own axis. */
export function mirrorSelection(axis: "x" | "y" | "z"): void {
  if (!guard()) return;
  const s = editor();
  const puts = s.selection
    .map((id) => s.objects.get(id))
    .filter((o): o is SceneObject => !!o)
    .map((o) => {
      const next = cloneObject(o);
      next.scale[axis] = -next.scale[axis];
      return next;
    });
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, `Mirror ${axis.toUpperCase()}`);
}

/** Ctrl+J: merge every selected solid into the active one. */
export function joinSelection(): void {
  if (!guard()) return;
  const s = editor();
  const active = activeObject(s);
  const solids = solidsInSelection();
  if (!active || !isSolid(active.kind) || solids.length < 2) {
    s.notify("Select two or more meshes; the last one selected keeps the result.", true);
    return;
  }
  const into = worldMatrix(active.id, s.objects).invert();
  const shapes: MeshShape[] = [];
  for (const o of solids) {
    const shape = shapeOf(o);
    if (!shape) continue;
    shapes.push(transformShape(shape, into.clone().multiply(worldMatrix(o.id, s.objects))));
  }
  const joined = joinShapes(shapes);
  if (!checkLimits(joined, "The joined mesh")) return;
  const others = solids.filter((o) => o.id !== active.id).map((o) => o.id);
  // Children of the merged-away objects move to the survivor, in place.
  const index = childrenIndex(s.objects);
  const adopted: SceneObject[] = [];
  for (const id of others) {
    for (const child of index.get(id) ?? []) {
      if (others.includes(child.id)) continue;
      const next = reparent(child.id, active.id, s.objects);
      if (next) adopted.push(next);
    }
  }
  s.commit(
    { puts: [{ ...cloneObject(active), kind: "mesh" }, ...adopted], deletes: others, meshes: [{ id: active.id, shape: joined }] },
    "Join",
  );
  s.select([active.id]);
}

/** Sit each selected object on the ground plane. */
export function dropToGround(): void {
  if (!guard() || !view) return;
  const s = editor();
  const puts: SceneObject[] = [];
  for (const id of topmost(s.selection, s.objects)) {
    const box = view.worldBox(id);
    const o = s.objects.get(id);
    if (!box || !o || box.isEmpty()) continue;
    const lift = -box.min.y;
    if (Math.abs(lift) < 1e-6) continue;
    const world = worldMatrix(id, s.objects).premultiply(new THREE.Matrix4().makeTranslation(0, lift, 0));
    const parent = resolvedParent(o, s.objects);
    const parentWorld = parent ? worldMatrix(parent, s.objects) : new THREE.Matrix4();
    puts.push(withMatrix(o, parentWorld.invert().multiply(world)));
  }
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, "Drop to ground");
}

export function resetTransform(part: "position" | "rotation" | "scale"): void {
  if (!guard()) return;
  const s = editor();
  const value = part === "scale" ? vec(1, 1, 1) : vec();
  const puts = s.selection
    .map((id) => s.objects.get(id))
    .filter((o): o is SceneObject => !!o)
    .map((o) => ({ ...cloneObject(o), [part]: value }));
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, `Clear ${part}`);
}

// ── Edit mode ───────────────────────────────────────────────────────────────

/** Tab: into edit mode on the active object, converting a primitive on the way. */
export function toggleEditMode(): void {
  const s = editor();
  if (s.mode === "edit") {
    s.setMode("object");
    return;
  }
  const active = activeObject(s);
  if (!active || !isSolid(active.kind)) {
    s.notify("Select a mesh or a primitive to edit its vertices.", true);
    return;
  }
  if (!guard()) return;
  if (active.kind !== "mesh") convertToMesh([active.id]);
  editor().select([active.id]);
  editor().setMode("edit");
  editor().setTool(editor().tool === "select" ? "translate" : editor().tool);
}

function editShape(): { id: string; shape: MeshShape } | null {
  const s = editor();
  const active = activeObject(s);
  const shape = active ? s.meshes.get(active.id)?.shape : undefined;
  return active && shape ? { id: active.id, shape } : null;
}

export function deleteSelectedVertices(): void {
  if (!guard()) return;
  const target = editShape();
  const s = editor();
  if (!target || !s.vertexSelection.size) return;
  const next = deleteVertices(target.shape, s.vertexSelection);
  s.commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: next }] }, `Delete ${s.vertexSelection.size} vertices`);
  s.setVertexSelection(new Set());
}

export function extrudeSelected(): void {
  if (!guard()) return;
  const target = editShape();
  const s = editor();
  if (!target) return;
  const result = extrudeRegion(target.shape, s.vertexSelection);
  if (!result) {
    s.notify("Select whole faces (all three corners of a triangle) to extrude.", true);
    return;
  }
  if (!checkLimits(result.shape, "The extruded mesh")) return;
  s.commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: result.shape }] }, "Extrude");
  s.setVertexSelection(result.selection);
  s.setTool("translate");
}

export function mergeSelectedVertices(): void {
  if (!guard()) return;
  const target = editShape();
  const s = editor();
  if (!target || s.vertexSelection.size < 2) return;
  // Merge at the centre: move every picked vertex there, then weld.
  const c = new THREE.Vector3();
  for (const i of s.vertexSelection) {
    c.x += target.shape.positions[i * 3]!;
    c.y += target.shape.positions[i * 3 + 1]!;
    c.z += target.shape.positions[i * 3 + 2]!;
  }
  c.divideScalar(s.vertexSelection.size);
  const positions = target.shape.positions.slice();
  for (const i of s.vertexSelection) {
    positions[i * 3] = c.x;
    positions[i * 3 + 1] = c.y;
    positions[i * 3 + 2] = c.z;
  }
  const next = mergeByDistance({ positions, indices: target.shape.indices }, 1e-6, s.vertexSelection);
  s.commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: next }] }, "Merge vertices");
  s.setVertexSelection(new Set());
}

export function smoothSelectedVertices(): void {
  if (!guard()) return;
  const target = editShape();
  const s = editor();
  if (!target) return;
  const only = s.vertexSelection.size ? s.vertexSelection : undefined;
  s.commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: smooth(target.shape, 0.5, 1, only) }] }, "Smooth vertices");
}

export function subdivideActive(): void {
  if (!guard()) return;
  const target = editShape();
  const s = editor();
  if (!target) return;
  const next = subdivide(target.shape);
  if (!checkLimits(next, "The subdivided mesh")) return;
  s.commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: next }] }, "Subdivide");
  s.setVertexSelection(new Set());
}

// ── Scene ───────────────────────────────────────────────────────────────────

export function renameObject(id: string, name: string): void {
  if (!guard()) return;
  const s = editor();
  const o = s.objects.get(id);
  const clean = name.trim();
  if (!o || !clean || clean === o.name) return;
  s.commit({ puts: [{ ...cloneObject(o), name: clean.slice(0, 80) }], deletes: [], meshes: [] }, "Rename");
}

/** Change fields of objects as one undo step. */
export function updateObjects(ids: string[], patch: (o: SceneObject) => SceneObject, label: string): void {
  if (!guard()) return;
  const s = editor();
  const puts = ids.map((id) => s.objects.get(id)).filter((o): o is SceneObject => !!o).map((o) => patch(cloneObject(o)));
  if (puts.length) s.commit({ puts, deletes: [], meshes: [] }, label);
}
