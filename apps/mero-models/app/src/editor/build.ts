import * as THREE from "three";
import { geometryFromShape, primitiveGeometry, type MeshShape } from "./geometry";
import { isLight, type SceneObject } from "./model";

/**
 * The parts one scene object is drawn with.
 *
 * `group` carries the object's transform and is what children hang under.
 * `body` is the thing itself — a mesh or a light — and `helper` is the
 * viewport-only glyph a light or an empty is picked and seen by; an export
 * leaves helpers out.
 */
export interface Built {
  group: THREE.Group;
  body: THREE.Object3D | null;
  helper: THREE.Object3D | null;
}

/**
 * Finds a material's texture by id: the ready texture, or null while it loads
 * (the material is rebuilt when it lands) or when the id names nothing.
 */
export type TextureLookup = (textureId: string, colorSpace: "srgb" | "linear") => THREE.Texture | null;

export function hasMaps(o: SceneObject): boolean {
  const m = o.material;
  return !!(m.base_color_map || m.normal_map || m.orm_map || m.emissive_map);
}

export function standardMaterial(o: SceneObject, textures?: TextureLookup): THREE.MeshStandardMaterial {
  const m = o.material;
  const tex = (id: string, cs: "srgb" | "linear") => (id && textures ? textures(id, cs) : null);
  const map = tex(m.base_color_map, "srgb");
  const normalMap = tex(m.normal_map, "linear");
  const orm = tex(m.orm_map, "linear");
  const emissiveMap = tex(m.emissive_map, "srgb");
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(m.normal_scale, m.normal_scale),
    // One packed texture drives all three, in glTF's (and Unreal's) channel
    // layout — exactly the channels three reads each map from.
    aoMap: orm,
    roughnessMap: orm,
    metalnessMap: orm,
    emissiveMap,
    color: new THREE.Color(m.color),
    metalness: m.metalness,
    roughness: m.roughness,
    opacity: m.opacity,
    transparent: m.opacity < 1,
    depthWrite: m.opacity >= 1,
    // An emission map is multiplied by the emissive colour; black would hide it.
    emissive: new THREE.Color(emissiveMap && m.emissive === "#000000" ? "#ffffff" : m.emissive),
    wireframe: m.wireframe,
    flatShading: m.flat_shading,
    side: o.kind === "plane" || o.kind === "mesh" ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** The geometry an object draws with, or null for one that has no surface. */
export function geometryFor(o: SceneObject, mesh: MeshShape | undefined): THREE.BufferGeometry | null {
  // A mesh with no UVs of its own gets box-projected ones, so a texture lands on it.
  if (o.kind === "mesh") return mesh ? geometryFromShape(mesh, true) : null;
  return primitiveGeometry(o.kind, o.segments);
}

export function applyTransform(target: THREE.Object3D, o: SceneObject): void {
  target.position.set(o.position.x, o.position.y, o.position.z);
  target.rotation.set(o.rotation.x, o.rotation.y, o.rotation.z, "XYZ");
  target.scale.set(o.scale.x, o.scale.y, o.scale.z);
}

/**
 * Lights point down their local -Y, so rotating the object aims the light the
 * same way it would aim a spotlight prop in the viewport.
 */
type ShadowLight = THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;

function makeLight(o: SceneObject): ShadowLight {
  const color = new THREE.Color(o.material.color);
  let light: ShadowLight;
  if (o.kind === "point_light") {
    light = new THREE.PointLight(color, o.intensity, 0, 2);
  } else if (o.kind === "spot_light") {
    const spot = new THREE.SpotLight(color, o.intensity, 0, Math.PI / 6, 0.3, 2);
    const target = new THREE.Object3D();
    target.position.set(0, -1, 0);
    spot.add(target);
    spot.target = target;
    light = spot;
  } else {
    const sun = new THREE.DirectionalLight(color, o.intensity);
    const target = new THREE.Object3D();
    target.position.set(0, -1, 0);
    sun.add(target);
    sun.target = target;
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15;
    sun.shadow.camera.bottom = -15;
    light = sun;
  }
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0005;
  return light;
}

const helperMaterialCache = new Map<string, THREE.Material>();

function helperLineMaterial(color: string): THREE.LineBasicMaterial {
  const key = `line:${color}`;
  let m = helperMaterialCache.get(key) as THREE.LineBasicMaterial | undefined;
  if (!m) {
    m = new THREE.LineBasicMaterial({ color, depthTest: true, transparent: true, opacity: 0.9 });
    helperMaterialCache.set(key, m);
  }
  return m;
}

/** The glyph an empty or a light is seen and clicked by. */
function makeHelper(o: SceneObject, meshMissing = false): THREE.Object3D | null {
  if (meshMissing) {
    // A mesh whose blob has not arrived yet: a box to see and pick it by.
    return new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), helperLineMaterial("#6e707a"));
  }
  if (o.kind === "group") {
    // Three axes, Blender's "plain axes" empty.
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5], 3),
    );
    return new THREE.LineSegments(g, helperLineMaterial("#d8d8d8"));
  }
  if (!isLight(o.kind)) return null;
  const color = o.material.color;
  const group = new THREE.Group();
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 8),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
  group.add(bulb);
  if (o.kind === "point_light") {
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.24, 0)), helperLineMaterial(color)));
  } else {
    // A line down local -Y shows which way it points.
    const g = new THREE.BufferGeometry();
    const length = o.kind === "directional_light" ? 1.5 : 1;
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, -length, 0], 3));
    group.add(new THREE.LineSegments(g, helperLineMaterial(color)));
    if (o.kind === "spot_light") {
      const cone = new THREE.ConeGeometry(0.35, 0.6, 12, 1, true);
      cone.translate(0, -0.3, 0);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(cone, 1), helperLineMaterial(color)));
      group.add(new THREE.LineSegments(new THREE.WireframeGeometry(cone), helperLineMaterial(color)));
    } else {
      const ring = new THREE.RingGeometry(0.2, 0.22, 24);
      ring.rotateX(-Math.PI / 2);
      group.add(new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    }
  }
  return group;
}

/** Build the drawable parts for `o`. Transforms are set; children are the caller's job. */
export function buildObject(
  o: SceneObject,
  mesh: MeshShape | undefined,
  withHelpers = true,
  textures?: TextureLookup,
): Built {
  const group = new THREE.Group();
  group.name = o.name;
  group.userData.id = o.id;
  applyTransform(group, o);
  group.visible = o.visible;

  let body: THREE.Object3D | null = null;
  if (isLight(o.kind)) {
    body = makeLight(o);
  } else {
    const geometry = geometryFor(o, mesh);
    if (geometry) {
      const m = new THREE.Mesh(geometry, standardMaterial(o, textures));
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = o.name;
      body = m;
    }
  }
  if (body) {
    body.userData.id = o.id;
    group.add(body);
  }
  const helper = withHelpers ? makeHelper(o, o.kind === "mesh" && !mesh) : null;
  if (helper) {
    helper.userData.id = o.id;
    helper.userData.helper = true;
    helper.traverse((c) => (c.userData.id = o.id));
    group.add(helper);
  }
  return { group, body, helper };
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (material && !Array.isArray(material) && ![...helperMaterialCache.values()].includes(material)) {
      material.dispose();
    }
    const light = c as ShadowLight;
    if (light.isLight && light.shadow?.map) light.shadow.map.dispose();
  });
}

/**
 * The whole model as a plain three.js scene, for export: the hierarchy, the
 * meshes, the materials and the lights, with no viewport helpers.
 */
export function buildScene(
  meshes: Map<string, { shape: MeshShape }>,
  childrenOf: Map<string, SceneObject[]>,
  onlyVisible = true,
  textures?: TextureLookup,
): THREE.Scene {
  const scene = new THREE.Scene();
  const add = (parentId: string, parent: THREE.Object3D) => {
    for (const o of childrenOf.get(parentId) ?? []) {
      if (onlyVisible && !o.visible) continue;
      const built = buildObject(o, meshes.get(o.id)?.shape, false, textures);
      parent.add(built.group);
      add(o.id, built.group);
    }
  };
  add("", scene);
  return scene;
}
