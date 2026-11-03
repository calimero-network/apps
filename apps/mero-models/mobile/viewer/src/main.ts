/**
 * The read-only 3D viewport both phone apps embed in a web view.
 *
 * It is the web studio's own drawing code (`app/src/editor/build.ts`,
 * `geometry.ts`, `meshcodec.ts`, `textures.ts`) with the studio's lights,
 * grid and shading modes, and none of its editing. The native app owns the
 * data: it reads the scene through the contract and hands it here, and it
 * fetches blobs when this page asks for them. So iOS and Android draw the same
 * pixels from the same code, and both draw what the web studio draws.
 *
 * Native -> page: `window.mmViewer.setScene(json)`, `.setBlob(id, base64|null)`,
 * `.select(id|null)`, `.frame(id|null)`, `.setShading("solid"|"rendered")`,
 * `.setGrid(bool)`.
 * Page -> native: `{type:"ready"}`, `{type:"blob", id}`, `{type:"pick", id}`,
 * `{type:"progress", pending}`, `{type:"error", message}`.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildObject, disposeObject, type Built, type TextureLookup } from "../../../app/src/editor/build";
import type { MeshShape } from "../../../app/src/editor/geometry";
import { decodeMesh } from "../../../app/src/editor/meshcodec";
import { childrenIndex, isLight, type Environment, type MeshRef, type SceneObject } from "../../../app/src/editor/model";
import { TextureCache } from "../../../app/src/editor/textures";
import type { BlobStore } from "../../../app/src/editor/blobs";
import type { TextureRef } from "../../../app/src/generated/MeroModelsClient";

interface ScenePayload {
  environment: Environment;
  objects: SceneObject[];
  meshes: MeshRef[];
  textures: TextureRef[];
}

type Outgoing =
  | { type: "ready" }
  | { type: "blob"; id: string }
  | { type: "pick"; id: string | null }
  | { type: "progress"; pending: number }
  | { type: "error"; message: string };

declare global {
  interface Window {
    webkit?: { messageHandlers?: { mm?: { postMessage(m: unknown): void } } };
    MMNative?: { postMessage(m: string): void };
    mmViewer: Viewer;
  }
}

function post(message: Outgoing): void {
  if (window.webkit?.messageHandlers?.mm) window.webkit.messageHandlers.mm.postMessage(message);
  else if (window.MMNative) window.MMNative.postMessage(JSON.stringify(message));
}

const SELECT_COLOR = new THREE.Color("#ffa033");
const DEFAULT_ENV: Environment = {
  name: "",
  background: "#24262b",
  ambient_color: "#ffffff",
  ambient_intensity: 0.35,
  updated_at: 0,
};

/** Blobs come from the native side, which reads them through the account's relay. */
class NativeBlobs {
  private waiting = new Map<string, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }[]>();
  private done = new Map<string, ArrayBuffer>();

  get pending(): number {
    return this.waiting.size;
  }

  get(blobId: string): Promise<ArrayBuffer> {
    const hit = this.done.get(blobId);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const list = this.waiting.get(blobId);
      if (list) {
        list.push({ resolve, reject });
        return;
      }
      this.waiting.set(blobId, [{ resolve, reject }]);
      post({ type: "blob", id: blobId });
      post({ type: "progress", pending: this.waiting.size });
    });
  }

  settle(blobId: string, base64: string | null): void {
    const list = this.waiting.get(blobId) ?? [];
    this.waiting.delete(blobId);
    if (base64 === null) {
      for (const w of list) w.reject(new Error(`blob ${blobId} could not be read`));
    } else {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      this.done.set(blobId, bytes.buffer);
      for (const w of list) w.resolve(bytes.buffer);
    }
    post({ type: "progress", pending: this.waiting.size });
  }
}

interface Node {
  obj: SceneObject;
  mesh: MeshShape | undefined;
  built: Built;
}

class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly outline: OutlinePass;
  private readonly root = new THREE.Group();
  private readonly studio = new THREE.Group();
  private readonly grid = new THREE.Group();
  private readonly ambient = new THREE.AmbientLight("#ffffff", 0.35);
  private readonly envMap: THREE.Texture;
  private readonly blobs = new NativeBlobs();
  private readonly textures = new TextureCache(this.blobs as unknown as BlobStore);
  private readonly nodes = new Map<string, Node>();
  /** Decoded shapes by blob id: a blob never changes, so neither does its shape. */
  private readonly shapes = new Map<string, MeshShape>();
  private readonly shapeLoads = new Set<string>();
  private payload: ScenePayload = { environment: DEFAULT_ENV, objects: [], meshes: [], textures: [] };
  private textureRefs = new Map<string, TextureRef>();
  private shading: "solid" | "rendered" = "solid";
  private selected: string | null = null;
  private framed = false;
  /** Until the person moves the camera, the view keeps fitting the scene as meshes land. */
  private touched = false;
  private dirty = true;
  private down: { x: number; y: number; t: number } | null = null;

  private readonly lookup: TextureLookup = (id, colorSpace) => {
    const ref = this.textureRefs.get(id);
    return ref ? this.textures.get(ref, colorSpace) : null;
  };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping, as in the studio: a colour shows as the colour picked.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const { width, height } = this.size();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
    this.camera.position.set(6, 4.5, 7.5);

    // One finger orbits, two pinch to zoom and drag to pan.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0.5, 0);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.addEventListener("start", () => (this.touched = true));

    // The studio's lighting, exactly.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight("#ffffff", "#3a3c44", 1.2);
    const key = new THREE.DirectionalLight("#ffffff", 1.4);
    key.position.set(3, 6, 4);
    const fill = new THREE.DirectionalLight("#cfd8ff", 0.5);
    fill.position.set(-5, 2, -3);
    this.studio.add(hemi, key, fill);
    this.scene.add(this.studio, this.ambient, this.root, this.grid);
    this.buildGrid();
    this.applyEnvironment(DEFAULT_ENV);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outline = new OutlinePass(new THREE.Vector2(width, height), this.scene, this.camera);
    this.outline.visibleEdgeColor.copy(SELECT_COLOR);
    this.outline.hiddenEdgeColor.set("#7a4a14");
    this.outline.edgeStrength = 4;
    this.outline.edgeThickness = 1;
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (e.isPrimary) this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener("pointerup", (e) => {
      const d = this.down;
      this.down = null;
      if (!d || !e.isPrimary) return;
      // A tap, not an orbit: pick what is under it.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 400) this.pick(e.clientX, e.clientY);
    });
    el.addEventListener("pointercancel", () => (this.down = null));

    new ResizeObserver(() => this.onResize()).observe(container);
    this.onResize();
    this.textures.onChange(() => this.rebuildMaterials());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ── native → page ──

  setScene(json: string | ScenePayload): void {
    try {
      const payload = typeof json === "string" ? (JSON.parse(json) as ScenePayload) : json;
      this.payload = payload;
      this.textureRefs = new Map(payload.textures.map((t) => [t.id, t]));
      this.applyEnvironment(payload.environment ?? DEFAULT_ENV);
      this.loadShapes();
      this.syncObjects();
      if (!this.framed && payload.objects.length > 0) {
        this.framed = true;
        this.frame(null, false);
      }
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  setBlob(id: string, base64: string | null): void {
    this.blobs.settle(id, base64);
  }

  select(id: string | null): void {
    this.selected = id && this.nodes.has(id) ? id : null;
    const node = this.selected ? this.nodes.get(this.selected) : undefined;
    const target = node ? (node.built.body && !(node.built.body as THREE.Light).isLight ? node.built.body : node.built.helper) : null;
    this.outline.selectedObjects = target ? [target] : [];
    this.dirty = true;
  }

  /** Frame one object, or everything (`null`). */
  frame(id: string | null, animate = true): void {
    const box = new THREE.Box3();
    const node = id ? this.nodes.get(id) : undefined;
    this.scene.updateMatrixWorld(true);
    if (node) box.setFromObject(node.built.group);
    else for (const n of this.nodes.values()) if (n.obj.visible && !isLight(n.obj.kind)) box.expandByObject(n.built.group);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.25);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = radius / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(6, 4.5, 7.5).normalize();
    const toTarget = sphere.center.clone();
    const toPosition = sphere.center.clone().add(dir.multiplyScalar(fit * 1.15));
    if (!animate) {
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toPosition);
      this.controls.update();
      this.dirty = true;
      return;
    }
    const fromTarget = this.controls.target.clone();
    const fromPosition = this.camera.position.clone();
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 350);
      const k = 1 - Math.pow(1 - t, 3);
      this.controls.target.lerpVectors(fromTarget, toTarget, k);
      this.camera.position.lerpVectors(fromPosition, toPosition, k);
      this.controls.update();
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setShading(mode: "solid" | "rendered"): void {
    this.shading = mode;
    this.applyShading();
  }

  setGrid(on: boolean): void {
    this.grid.visible = on;
    this.dirty = true;
  }

  // ── scene ──

  private applyEnvironment(env: Environment): void {
    this.scene.background = new THREE.Color(env.background || DEFAULT_ENV.background);
    this.ambient.color.set(env.ambient_color || DEFAULT_ENV.ambient_color);
    this.ambient.intensity = env.ambient_intensity;
    this.dirty = true;
  }

  /** Ask for each mesh blob not decoded yet, and redraw as they land. */
  private loadShapes(): void {
    for (const ref of this.payload.meshes) {
      if (this.shapes.has(ref.blob_id) || this.shapeLoads.has(ref.blob_id)) continue;
      this.shapeLoads.add(ref.blob_id);
      this.blobs
        .get(ref.blob_id)
        .then((bytes) => {
          this.shapes.set(ref.blob_id, decodeMesh(bytes, { vertex_count: ref.vertex_count, triangle_count: ref.triangle_count }));
          this.syncObjects();
          if (!this.touched) this.frame(null, false);
        })
        .catch((e) => post({ type: "error", message: `${ref.id}: ${e instanceof Error ? e.message : String(e)}` }))
        .finally(() => this.shapeLoads.delete(ref.blob_id));
    }
  }

  private shapeOf(id: string): MeshShape | undefined {
    const ref = this.payload.meshes.find((m) => m.id === id);
    return ref ? this.shapes.get(ref.blob_id) : undefined;
  }

  private syncObjects(): void {
    const objects = new Map(this.payload.objects.map((o) => [o.id, o]));
    for (const [id, node] of this.nodes) {
      if (objects.get(id) === undefined) {
        node.built.group.removeFromParent();
        disposeObject(node.built.group);
        this.nodes.delete(id);
      }
    }
    for (const obj of objects.values()) {
      const mesh = obj.kind === "mesh" ? this.shapeOf(obj.id) : undefined;
      const node = this.nodes.get(obj.id);
      if (node && node.obj.updated_at === obj.updated_at && JSON.stringify(node.obj) === JSON.stringify(obj) && node.mesh === mesh) continue;
      const built = buildObject(obj, mesh, true, this.lookup);
      if (node) {
        for (const child of [...node.built.group.children]) {
          if (child.userData.id && child.userData.id !== obj.id) built.group.add(child);
        }
        node.built.group.removeFromParent();
        if (node.built.body) disposeObject(node.built.body);
        if (node.built.helper) disposeObject(node.built.helper);
      }
      this.nodes.set(obj.id, { obj, mesh, built });
    }
    const children = childrenIndex(objects);
    const attach = (parentId: string, parent: THREE.Object3D) => {
      for (const o of children.get(parentId) ?? []) {
        const node = this.nodes.get(o.id)!;
        if (node.built.group.parent !== parent) parent.add(node.built.group);
        attach(o.id, node.built.group);
      }
    };
    attach("", this.root);
    this.scene.updateMatrixWorld(true);
    this.applyShading();
    this.select(this.selected);
  }

  private rebuildMaterials(): void {
    // A texture landed: rebuild the objects that use maps so they pick it up.
    for (const node of [...this.nodes.values()]) {
      const m = node.obj.material;
      if (m.base_color_map || m.normal_map || m.orm_map || m.emissive_map) {
        this.nodes.set(node.obj.id, { ...node, obj: { ...node.obj, updated_at: -1 } as SceneObject });
      }
    }
    this.syncObjects();
  }

  private applyShading(): void {
    const rendered = this.shading === "rendered";
    this.studio.visible = !rendered;
    this.scene.environment = rendered ? this.envMap : null;
    this.scene.environmentIntensity = 0.45;
    this.renderer.shadowMap.enabled = rendered;
    for (const node of this.nodes.values()) {
      const body = node.built.body;
      if (!body) continue;
      if ((body as THREE.Light).isLight) {
        body.visible = rendered;
        continue;
      }
      const material = (body as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.envMapIntensity = rendered ? 1 : 0;
      material.needsUpdate = true;
    }
    this.dirty = true;
  }

  private pick(x: number, y: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 0.06 };
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.root, true);
    let id: string | null = null;
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      if (!o.visible) continue;
      while (o && !o.userData.id) o = o.parent;
      if (o?.userData.id) {
        id = o.userData.id as string;
        break;
      }
    }
    this.select(id);
    post({ type: "pick", id });
  }

  private buildGrid(): void {
    const minor = new THREE.GridHelper(40, 40, "#3a3d44", "#33363c");
    (minor.material as THREE.Material).transparent = true;
    (minor.material as THREE.Material).opacity = 0.8;
    const major = new THREE.GridHelper(40, 4, "#4a4e57", "#4a4e57");
    (major.material as THREE.Material).transparent = true;
    (major.material as THREE.Material).opacity = 0.9;
    major.position.y = 0.001;
    const axis = (from: number[], to: number[], color: string) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([...from, ...to], 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
      line.position.y = 0.002;
      return line;
    };
    this.grid.add(minor, major, axis([-20, 0, 0], [20, 0, 0], "#c0474d"), axis([0, 0, -20], [0, 0, 20], "#3f72c7"));
  }

  private size(): { width: number; height: number } {
    return { width: Math.max(1, this.container.clientWidth), height: Math.max(1, this.container.clientHeight) };
  }

  private onResize(): void {
    const { width, height } = this.size();
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.outline?.resolution.set(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private tick(): void {
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.composer.render();
  }
}

const container = document.getElementById("viewport")!;
try {
  window.mmViewer = new Viewer(container);
  post({ type: "ready" });
} catch (e) {
  post({ type: "error", message: e instanceof Error ? e.message : String(e) });
}
