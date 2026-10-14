import * as THREE from "three";
import { cloneObject, resolvedParent, type SceneObject } from "./model";

/** An object's transform relative to its parent. */
export function localMatrix(o: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(o.position.x, o.position.y, o.position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation.x, o.rotation.y, o.rotation.z, "XYZ")),
    new THREE.Vector3(o.scale.x, o.scale.y, o.scale.z),
  );
}

/** An object's transform in the scene, walking its (resolved) parents. */
export function worldMatrix(id: string, objects: Map<string, SceneObject>): THREE.Matrix4 {
  const chain: SceneObject[] = [];
  let at: SceneObject | undefined = objects.get(id);
  while (at) {
    chain.unshift(at);
    const parent = resolvedParent(at, objects);
    at = parent ? objects.get(parent) : undefined;
  }
  const m = new THREE.Matrix4();
  for (const o of chain) m.multiply(localMatrix(o));
  return m;
}

/** `o` with its transform replaced by `m`. Rounded so a round trip does not drift. */
export function withMatrix(o: SceneObject, m: THREE.Matrix4): SceneObject {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const next = cloneObject(o);
  next.position = { x: round(p.x), y: round(p.y), z: round(p.z) };
  next.rotation = { x: round(e.x), y: round(e.y), z: round(e.z) };
  next.scale = { x: round(s.x), y: round(s.y), z: round(s.z) };
  return next;
}

export function round(v: number, places = 5): number {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * `id` moved under `parent` (`""` for the root) without moving on screen: its
 * local transform is recomputed against the new parent's world transform.
 */
export function reparent(
  id: string,
  parent: string,
  objects: Map<string, SceneObject>,
): SceneObject | undefined {
  const o = objects.get(id);
  if (!o) return undefined;
  const world = worldMatrix(id, objects);
  const parentWorld = parent ? worldMatrix(parent, objects) : new THREE.Matrix4();
  const local = parentWorld.clone().invert().multiply(world);
  const next = withMatrix(o, local);
  next.parent = parent;
  return next;
}
