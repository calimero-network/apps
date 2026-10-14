import * as THREE from "three";
import {
  decimate,
  fitsLimits,
  flipNormals,
  joinShapes,
  mergeByDistance,
  shapeCenter,
  smooth,
  subdivide,
  transformShape,
  triangleCount,
  vertexCount,
  type MeshShape,
} from "./geometry";
import {
  EDIT_MAX_VERTICES,
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
import { EXAMPLES, exampleChange } from "./examples";
import { packIslands, smartProject, transformUvs, unwrap, uvCenter, uvIslands } from "./uv";
import { MAX_EVALUATED_CORNERS, catmullClark, evaluate } from "./modifiers";
import {
  edgeEnds,
  edgesOfVerts,
  facesOfVerts,
  vertexTotal,
  vertsOfEdges,
  vertsOfFaces,
  withModifiers,
  uvSeams,
  type Axis,
  type Modifier,
  type Poly,
  type V3,
} from "./poly";
import {
  MeshOpError,
  bevelEdges,
  bisect,
  bridgeLoops,
  connectVerts,
  deleteEdgesPoly,
  deleteFacesPoly,
  deleteVertsPoly,
  dissolveEdges,
  dissolveFaces,
  dissolveVerts,
  edgeLoop,
  edgeRing,
  extrudeEdges,
  extrudeFaces,
  fillLoops,
  flipPoly,
  insetFaces,
  joinPolys,
  linked,
  loopCut,
  mergeAtCenter,
  mergeByDistancePoly,
  setSharp,
  smoothPoly,
  symmetrize,
  transformPoly,
  type OpResult,
} from "./polyops";
import { AUTO_SHARP_DEGREES, polyOf, primitivePoly, shapeFromPoly, sharpByAngle, skippedModifiers } from "./polymesh";
import { activeObject, emptyChange, useEditor, type Change, type LastOp, type OpParam, type SelectMode, type Snapshot } from "./store";
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

/**
 * The shape a solid object draws, in its own space: its mesh, or its
 * primitive's — as a polygon cage with the primitive's own UVs and hard edges,
 * so a converted cube is six quads ready for loop cuts and bevels.
 */
export function shapeOf(o: SceneObject): MeshShape | null {
  if (o.kind === "mesh") return editor().meshes.get(o.id)?.shape ?? null;
  const poly = primitivePoly(o.kind, o.segments);
  return poly ? shapeFromPoly(poly) : null;
}

/** A shape with a transform baked in, keeping its cage when it has one. */
function bake(shape: MeshShape, matrix: THREE.Matrix4): MeshShape {
  return shape.poly ? shapeFromPoly(transformPoly(shape.poly, matrix.elements)) : transformShape(shape, matrix);
}

/** A cage op on cages, the triangle op otherwise. */
const either =
  (onCage: (p: Poly) => Poly, onTriangles: (s: MeshShape) => MeshShape) =>
  (shape: MeshShape): MeshShape =>
    shape.poly ? shapeFromPoly(onCage(shape.poly)) : onTriangles(shape);

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

/** Add an example asset (or every one, `"showcase"`) built with the modelling tools. */
export function addExample(key: string): void {
  if (!guard()) return;
  const at = view?.cursor() ?? new THREE.Vector3();
  const { change, roots } = exampleChange(key, names(), vec(at.x, 0, at.z));
  if (!roomFor(change.puts.length)) return;
  const s = editor();
  s.setMode("object");
  s.commit(change, key === "showcase" ? "Add example showcase" : `Add example ${EXAMPLES.find((e) => e.key === key)?.name ?? key}`);
  s.select(roots);
  view?.frameSelection(true);
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
    const target = editTarget();
    if (!target) return;
    const all = vertexTotal(target.poly);
    const everything = s.selectMode === "face" ? s.faceSelection.size === target.poly.faces.length : s.vertexSelection.size === all;
    if (everything) return deselect();
    if (s.selectMode === "face") s.setFaceSelection(new Set(target.poly.faces.keys()), new Set(Array.from({ length: all }, (_, i) => i)));
    else s.setVertexSelection(new Set(Array.from({ length: all }, (_, i) => i)));
    return;
  }
  s.select([...s.objects.values()].filter((o) => o.visible).map((o) => o.id));
}

export function invertSelection(): void {
  const s = editor();
  if (s.mode === "edit") {
    const target = editTarget();
    if (!target) return;
    if (s.selectMode === "face") {
      const faces = new Set([...target.poly.faces.keys()].filter((f) => !s.faceSelection.has(f)));
      s.setFaceSelection(faces, vertsOfFaces(target.poly, faces));
      return;
    }
    const next = new Set<number>();
    for (let i = 0; i < vertexTotal(target.poly); i += 1) if (!s.vertexSelection.has(i)) next.add(i);
    s.setVertexSelection(next);
    return;
  }
  const chosen = new Set(s.selection);
  s.select([...s.objects.values()].filter((o) => o.visible && !chosen.has(o.id)).map((o) => o.id));
}

export function deselect(): void {
  const s = editor();
  if (s.mode === "edit") s.setFaceSelection(new Set(), new Set());
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

export const subdivideSelection = () => reshape("Subdivide", either((p) => catmullClark(p, false), subdivide));
export const smoothSelection = () => reshape("Smooth", either((p) => smoothPoly(p, 0.5, 2), (s) => smooth(s, 0.5, 2)));
export const flipSelection = () => reshape("Flip normals", either(flipPoly, flipNormals));
export const mergeSelection = () => reshape("Merge by distance", either((p) => mergeByDistancePoly(p, 1e-3), (s) => mergeByDistance(s, 1e-3)));
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
    change.meshes.push({ id: o.id, shape: bake(shape, rs) });
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
    change.meshes.push({ id: o.id, shape: bake(shape, new THREE.Matrix4().makeTranslation(c.clone().negate())) });
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
    shapes.push(bake(shape, into.clone().multiply(worldMatrix(o.id, s.objects))));
  }
  // Cages join as a cage, each part's modifiers applied first; anything else as triangles.
  const joined = shapes.every((sh) => sh.poly)
    ? shapeFromPoly(joinPolys(shapes.map((sh) => withModifiers(evaluate(sh.poly!).poly, []))))
    : joinShapes(shapes);
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
  const stored = active.kind === "mesh" ? s.meshes.get(active.id)?.shape : undefined;
  const verts = stored ? (stored.poly ? vertexTotal(stored.poly) : vertexCount(stored)) : 0;
  if (verts > EDIT_MAX_VERTICES) {
    s.notify(`${active.name} has ${verts.toLocaleString()} vertices; vertex editing in the browser stops at ${EDIT_MAX_VERTICES.toLocaleString()}. Decimate a copy, or edit it in your DCC and re-import as a new version.`, true);
    return;
  }
  if (active.kind === "mesh" && !stored) {
    s.notify(`${active.name} is still downloading.`, true);
    return;
  }
  if (active.kind !== "mesh") convertToMesh([active.id]);
  editor().select([active.id]);
  editor().setMode("edit");
  editor().setTool(editor().tool === "select" ? "translate" : editor().tool);
}

/** The mesh being edited, with its cage. */
export function editTarget(): { id: string; shape: MeshShape; poly: Poly } | null {
  const s = editor();
  const active = activeObject(s);
  const shape = active ? s.meshes.get(active.id)?.shape : undefined;
  return active && shape ? { id: active.id, shape, poly: polyOf(shape) } : null;
}

/** What is selected on the cage, in every form a tool might want. */
export interface CageSelection {
  verts: Set<number>;
  edges: Set<number>;
  faces: Set<number>;
}

export function cageSelection(poly: Poly): CageSelection {
  const s = editor();
  const n = vertexTotal(poly);
  const verts = new Set([...s.vertexSelection].filter((v) => v < n));
  const faces =
    s.selectMode === "face" ? new Set([...s.faceSelection].filter((f) => f < poly.faces.length)) : facesOfVerts(poly, verts);
  return { verts, edges: edgesOfVerts(poly, verts), faces };
}

/** Put a tool's resulting selection into the store, in the current select mode's terms. */
function applySelection(poly: Poly, result: OpResult): void {
  const s = editor();
  if (result.faces) {
    const faces = result.faces;
    const verts = vertsOfFaces(poly, faces);
    if (s.selectMode === "face") s.setFaceSelection(faces, verts);
    else s.setVertexSelection(verts);
  } else if (result.verts) {
    if (s.selectMode === "face") s.setFaceSelection(facesOfVerts(poly, result.verts), result.verts);
    else s.setVertexSelection(result.verts);
  }
}

type Values = Record<string, number | boolean>;

/**
 * Run a mesh tool on the edited cage. With `params`, the operator panel can
 * re-run it from the same starting mesh with other values, replacing the
 * result rather than stacking another one on top.
 */
function cageOp(
  label: string,
  run: (poly: Poly, sel: CageSelection, values: Values) => OpResult,
  params: OpParam[] = [],
  defaults: Values = {},
): boolean {
  if (!guard()) return false;
  const target = editTarget();
  if (!target) return false;
  const sel = cageSelection(target.poly);
  const attempt = (values: Values): { result: OpResult; shape: MeshShape } | null => {
    let result: OpResult;
    try {
      result = run(target.poly, sel, values);
    } catch (e) {
      if (e instanceof MeshOpError) {
        editor().notify(e.message, true);
        return null;
      }
      throw e;
    }
    const shape = shapeFromPoly(result.poly);
    if (!checkLimits(shape, `${label}`)) return null;
    return { result, shape };
  };
  const first = attempt(defaults);
  if (!first) return false;
  editor().commit({ puts: [], deletes: [], meshes: [{ id: target.id, shape: first.shape }] }, label);
  applySelection(first.result.poly, first.result);
  if (params.length) {
    const lastOp: LastOp = {
      label,
      params,
      values: defaults,
      rerun: (values, final) => {
        const next = attempt(values);
        if (!next) return;
        const s = editor();
        if (final) s.amend({ puts: [], deletes: [], meshes: [{ id: target.id, shape: next.shape }] }, label);
        else s.preview([], [{ id: target.id, shape: next.shape }]);
        applySelection(next.result.poly, next.result);
        editor().set({ lastOp: { ...lastOp, values } });
      },
    };
    editor().set({ lastOp });
  }
  return true;
}

/** Exactly one selected edge, for tools that start from one. */
function oneEdge(sel: CageSelection, what: string): [number, number] {
  if (sel.edges.size < 1) throw new MeshOpError(`${what} starts from an edge — select one (edge mode, 2).`);
  return edgeEnds([...sel.edges][0]!);
}

export function deleteSelectedVertices(): void {
  const mode = editor().selectMode;
  cageOp(mode === "face" ? "Delete faces" : mode === "edge" ? "Delete edges" : "Delete vertices", (poly, sel) => {
    if (mode === "face") {
      if (!sel.faces.size) throw new MeshOpError("Select faces to delete.");
      return { poly: deleteFacesPoly(poly, sel.faces), verts: new Set() };
    }
    if (mode === "edge") {
      if (!sel.edges.size) throw new MeshOpError("Select edges to delete.");
      return { poly: deleteEdgesPoly(poly, sel.edges), verts: new Set() };
    }
    if (!sel.verts.size) throw new MeshOpError("Select vertices to delete.");
    return { poly: deleteVertsPoly(poly, sel.verts), verts: new Set() };
  });
}

/** E: extrude faces along their normals, or an open border outward. */
export function extrudeSelected(): void {
  const target = editTarget();
  if (!target) return;
  const sel = cageSelection(target.poly);
  const ok = sel.faces.size
    ? cageOp(
        "Extrude",
        (poly, s, v) => extrudeFaces(poly, s.faces, v.distance as number),
        [{ key: "distance", label: "Distance", kind: "number", min: -5, max: 5, step: 0.01 }],
        { distance: 0.25 },
      )
    : cageOp(
        "Extrude edges",
        (poly, s, v) => extrudeEdges(poly, s.verts, v.distance as number),
        [{ key: "distance", label: "Distance", kind: "number", min: -5, max: 5, step: 0.01 }],
        { distance: 0.25 },
      );
  if (ok) editor().setTool("translate");
}

/** I: inset the selected faces. */
export function insetSelected(): void {
  cageOp(
    "Inset",
    (poly, sel, v) => insetFaces(poly, sel.faces, v.thickness as number, v.depth as number, v.individual as boolean),
    [
      { key: "thickness", label: "Thickness", kind: "number", min: 0, max: 2, step: 0.005 },
      { key: "depth", label: "Depth", kind: "number", min: -2, max: 2, step: 0.005 },
      { key: "individual", label: "Each face on its own", kind: "toggle" },
    ],
    { thickness: 0.08, depth: 0, individual: false },
  );
}

/** Ctrl+B: bevel the selected edges. */
export function bevelSelected(): void {
  cageOp(
    "Bevel",
    (poly, sel, v) => bevelEdges(poly, sel.edges, v.width as number),
    [{ key: "width", label: "Width", kind: "number", min: 0.001, max: 1, step: 0.001 }],
    { width: 0.05 },
  );
}

/** Ctrl+R: loop cut across the ring of the selected edge. */
export function loopCutSelected(): void {
  cageOp(
    "Loop cut",
    (poly, sel, v) => loopCut(poly, ...oneEdge(sel, "Loop cut"), v.cuts as number),
    [{ key: "cuts", label: "Cuts", kind: "number", min: 1, max: 32, step: 1, integer: true }],
    { cuts: 1 },
  );
}

export function bridgeSelected(): void {
  cageOp("Bridge edge loops", (poly, sel) => bridgeLoops(poly, sel.verts));
}

export function fillSelected(): void {
  cageOp("Fill", (poly, sel) => fillLoops(poly, sel.verts));
}

export function connectSelected(): void {
  cageOp("Connect vertices", (poly, sel) => connectVerts(poly, sel.verts));
}

/** Knife the cage along a plane through the selection's centre (or the origin). */
export function bisectSelected(): void {
  const target = editTarget();
  if (!target) return;
  const sel = cageSelection(target.poly);
  const centre: V3 = [0, 0, 0];
  for (const v of sel.verts) for (let k = 0; k < 3; k += 1) centre[k]! += target.poly.positions[v * 3 + k]! / sel.verts.size;
  cageOp(
    "Knife plane",
    (poly, _sel, v) => bisect(poly, v.axis as Axis, v.offset as number),
    [
      { key: "axis", label: "Across", kind: "choice", options: [{ value: 0, label: "X" }, { value: 1, label: "Y" }, { value: 2, label: "Z" }] },
      { key: "offset", label: "At", kind: "number", min: -50, max: 50, step: 0.01 },
    ],
    { axis: 1, offset: Math.round(centre[1] * 1000) / 1000 },
  );
}

export function mergeSelectedVertices(): void {
  cageOp("Merge at centre", (poly, sel) => mergeAtCenter(poly, sel.verts));
}

export function mergeByDistanceSelected(): void {
  cageOp(
    "Merge by distance",
    (poly, sel, v) => ({ poly: mergeByDistancePoly(poly, v.distance as number, sel.verts.size ? sel.verts : undefined), verts: new Set() }),
    [{ key: "distance", label: "Distance", kind: "number", min: 0, max: 1, step: 0.0001 }],
    { distance: 0.001 },
  );
}

/** Dissolve, in the terms of the select mode: vertices, edges or faces. */
export function dissolveSelected(): void {
  const mode = editor().selectMode;
  if (mode === "face") cageOp("Dissolve faces", (poly, sel) => dissolveFaces(poly, sel.faces));
  else if (mode === "edge") cageOp("Dissolve edges", (poly, sel) => dissolveEdges(poly, sel.edges));
  else cageOp("Dissolve vertices", (poly, sel) => dissolveVerts(poly, sel.verts));
}

export function smoothSelectedVertices(): void {
  cageOp(
    "Smooth vertices",
    (poly, sel, v) => ({ poly: smoothPoly(poly, v.strength as number, v.repeat as number, sel.verts.size ? sel.verts : undefined), verts: sel.verts }),
    [
      { key: "strength", label: "Strength", kind: "number", min: 0, max: 1, step: 0.05 },
      { key: "repeat", label: "Repeat", kind: "number", min: 1, max: 50, step: 1, integer: true },
    ],
    { strength: 0.5, repeat: 1 },
  );
}

export function subdivideActive(): void {
  cageOp(
    "Subdivide",
    (poly, _sel, v) => {
      let out = poly;
      for (let i = 0; i < (v.cuts as number); i += 1) out = catmullClark(out, v.smooth as boolean);
      return { poly: out, verts: new Set() };
    },
    [
      { key: "cuts", label: "Levels", kind: "number", min: 1, max: 3, step: 1, integer: true },
      { key: "smooth", label: "Smooth", kind: "toggle" },
    ],
    { cuts: 1, smooth: false },
  );
}

export function symmetrizeActive(): void {
  cageOp(
    "Symmetrize",
    (poly, _sel, v) => ({ poly: symmetrize(poly, v.axis as Axis, v.positive as boolean), verts: new Set() }),
    [
      { key: "axis", label: "Across", kind: "choice", options: [{ value: 0, label: "X" }, { value: 1, label: "Y" }, { value: 2, label: "Z" }] },
      { key: "positive", label: "Keep the + side", kind: "toggle" },
    ],
    { axis: 0, positive: true },
  );
}

/** Mark or clear the selected edges as hard. */
export function markSharpSelected(sharp: boolean): void {
  cageOp(sharp ? "Mark sharp" : "Clear sharp", (poly, sel) => {
    if (!sel.edges.size) throw new MeshOpError("Select the edges to mark.");
    return { poly: setSharp(poly, sel.edges, sharp), verts: sel.verts };
  });
}

/** Hard edges wherever faces meet at more than an angle. */
export function sharpByAngleActive(): void {
  cageOp(
    "Sharp by angle",
    (poly, sel, v) => ({ poly: { ...poly, sharp: sharpByAngle(poly, v.angle as number) }, verts: sel.verts }),
    [{ key: "angle", label: "Angle °", kind: "number", min: 1, max: 180, step: 1 }],
    { angle: AUTO_SHARP_DEGREES },
  );
}

/** Select the edge loop, ring or face loop through an edge, or what is linked. */
export function selectLoop(a: number, b: number, ring: boolean, add: boolean): void {
  const target = editTarget();
  if (!target) return;
  const s = editor();
  const { poly } = target;
  if (s.selectMode === "face") {
    const faces = edgeRing(poly, a, b).faces;
    const next = add ? new Set([...s.faceSelection, ...faces]) : faces;
    s.setFaceSelection(next, vertsOfFaces(poly, next));
    return;
  }
  const edges = ring ? edgeRing(poly, a, b).edges : edgeLoop(poly, a, b);
  const verts = vertsOfEdges(edges);
  s.setVertexSelection(add ? new Set([...s.vertexSelection, ...verts]) : verts);
}

/** 1, 2, 3: what a click picks. The selection carries over: into face mode as the faces it covers. */
export function setSelectMode(mode: SelectMode): void {
  const s = editor();
  if (mode === s.selectMode) return;
  const target = s.mode === "edit" ? editTarget() : null;
  const verts = s.vertexSelection;
  s.setSelectMode(mode);
  if (!target) return;
  if (mode === "face") {
    const faces = facesOfVerts(target.poly, verts);
    s.setFaceSelection(faces, vertsOfFaces(target.poly, faces));
  } else {
    s.setVertexSelection(verts);
  }
}

/** Grow the selected edges to their whole loops (or rings) — the menu twin of Alt-click. */
export function selectLoopsOfSelection(ring: boolean): void {
  const target = editTarget();
  if (!target) return;
  const s = editor();
  const sel = cageSelection(target.poly);
  if (!sel.edges.size) {
    s.notify("Select an edge first (edge mode, 2), then grow it to its loop or ring.", true);
    return;
  }
  const edges = [...sel.edges].flatMap((k) => {
    const [a, b] = edgeEnds(k);
    return ring ? edgeRing(target.poly, a, b).edges : edgeLoop(target.poly, a, b);
  });
  const verts = vertsOfEdges(edges);
  if (s.selectMode === "face") s.setFaceSelection(facesOfVerts(target.poly, verts), verts);
  else s.setVertexSelection(verts);
}

export function selectLinked(): void {
  const target = editTarget();
  if (!target) return;
  const s = editor();
  const verts = linked(target.poly, s.vertexSelection);
  if (s.selectMode === "face") s.setFaceSelection(facesOfVerts(target.poly, verts), verts);
  else s.setVertexSelection(verts);
}

// ── UVs ─────────────────────────────────────────────────────────────────────

/** The faces a UV tool works on: the selected ones, or all when none are. */
const uvFaces = (sel: CageSelection): Set<number> | null => (sel.faces.size ? sel.faces : null);

/** Mark or clear the selected edges as UV seams. */
export function markSeamSelected(seam: boolean): void {
  cageOp(seam ? "Mark seam" : "Clear seam", (poly, sel) => {
    if (!sel.edges.size) throw new MeshOpError("Select the edges to mark (edge mode, 2).");
    const seams = new Set(poly.seams);
    for (const k of sel.edges) {
      if (seam) seams.add(k);
      else seams.delete(k);
    }
    return { poly: { ...poly, seams }, verts: sel.verts };
  });
}

/** Seams wherever the UVs already split: what the current layout implies. */
export function seamsFromIslands(): void {
  cageOp("Seams from islands", (poly, sel) => ({ poly: { ...poly, seams: uvSeams(poly) }, verts: sel.verts }));
}

/** U: unwrap the selected faces (or everything) along the seams. */
export function unwrapSelected(): void {
  let projected = 0;
  const ok = cageOp(
    "Unwrap",
    (poly, sel, v) => {
      const out = unwrap(poly, uvFaces(sel), v.margin as number);
      projected = out.projected;
      return { poly: out.poly, faces: sel.faces };
    },
    [{ key: "margin", label: "Margin", kind: "number", min: 0, max: 0.2, step: 0.001 }],
    { margin: 0.01 },
  );
  if (ok && projected) {
    editor().notify(`${projected} faces form closed pieces with no seam to open them, so they were projected flat. Mark seams and unwrap again for a better fit.`);
  }
}

export function smartProjectSelected(): void {
  cageOp(
    "Smart UV project",
    (poly, sel, v) => ({ poly: smartProject(poly, uvFaces(sel), v.angle as number, v.margin as number), faces: sel.faces }),
    [
      { key: "angle", label: "Angle limit °", kind: "number", min: 1, max: 89, step: 1 },
      { key: "margin", label: "Margin", kind: "number", min: 0, max: 0.2, step: 0.001 },
    ],
    { angle: 66, margin: 0.01 },
  );
}

export function packSelected(): void {
  cageOp(
    "Pack islands",
    (poly, sel, v) => ({
      poly: packIslands(poly, sel.faces.size ? uvIslands(poly, sel.faces) : undefined, v.margin as number, v.rotate as boolean),
      faces: sel.faces,
    }),
    [
      { key: "margin", label: "Margin", kind: "number", min: 0, max: 0.2, step: 0.001 },
      { key: "rotate", label: "Rotate to fit", kind: "toggle" },
    ],
    { margin: 0.01, rotate: true },
  );
}

/** Turn, flip or scale the selected faces' UVs about their centre. */
export function transformSelectedUvs(kind: "rotate" | "flipU" | "flipV" | "grow" | "shrink"): void {
  const labels = { rotate: "Rotate UVs 90°", flipU: "Flip UVs horizontally", flipV: "Flip UVs vertically", grow: "Scale UVs up", shrink: "Scale UVs down" };
  cageOp(labels[kind], (poly, sel) => {
    if (!sel.faces.size) throw new MeshOpError("Select faces (in the 3D view or the UV editor) to transform their UVs.");
    const [cu, cv] = uvCenter(poly, sel.faces);
    const fn = (u: number, v: number): [number, number] => {
      const x = u - cu;
      const y = v - cv;
      switch (kind) {
        case "rotate":
          return [cu - y, cv + x];
        case "flipU":
          return [cu - x, v];
        case "flipV":
          return [u, cv - y];
        case "grow":
          return [cu + x * 1.25, cv + y * 1.25];
        case "shrink":
          return [cu + x * 0.8, cv + y * 0.8];
      }
    };
    return { poly: transformUvs(poly, sel.faces, fn), faces: sel.faces };
  });
}

// ── Modifiers ───────────────────────────────────────────────────────────────

/** Change the active mesh's modifier stack (converting a primitive first). */
export function setModifiers(id: string, modifiers: Modifier[], label: string, before?: Snapshot): void {
  if (!guard()) return;
  const s = editor();
  const o = s.objects.get(id);
  if (!o || !isSolid(o.kind)) return;
  const shape = shapeOf(o);
  if (!shape) {
    s.notify(`${o.name} is still downloading.`, true);
    return;
  }
  const next = modifiedShape(shape, modifiers);
  const change = emptyChange();
  if (o.kind !== "mesh") change.puts.push({ ...cloneObject(o), kind: "mesh" });
  change.meshes.push({ id, shape: next });
  s.commit(change, label, before);
  const skipped = skippedModifiers(next);
  if (skipped.length) s.notify(`${skipped.join(", ")} would make more than ${MAX_EVALUATED_CORNERS.toLocaleString()} face corners, so it is skipped.`, true);
}

/** The shape with another modifier stack: what a modifier field previews while it is dragged. */
export function modifiedShape(shape: MeshShape, modifiers: Modifier[]): MeshShape {
  return shapeFromPoly(withModifiers(polyOf(shape), modifiers));
}

/** Bake the stack into the cage: what is drawn becomes what is edited. */
export function applyModifiers(id: string): void {
  if (!guard()) return;
  const s = editor();
  const shape = s.meshes.get(id)?.shape;
  if (!shape?.poly?.modifiers.length) return;
  const baked = evaluate(shape.poly).poly;
  s.commit({ puts: [], deletes: [], meshes: [{ id, shape: shapeFromPoly(baked) }] }, "Apply modifiers");
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
