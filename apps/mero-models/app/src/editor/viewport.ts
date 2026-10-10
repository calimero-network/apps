import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { applyTransform, buildObject, disposeObject, standardMaterial, type Built } from "./build";
import { geometryFromShape, type MeshShape } from "./geometry";
import { childrenIndex, isLight, topmost, type SceneObject } from "./model";
import { activeObject, useEditor, type EditorState } from "./store";
import { withMatrix } from "./transform";

/** Someone else in the scene, as their presence slice describes them. */
export interface Peer {
  key: string;
  name: string;
  color: string;
  selection: string[];
  camera: [number, number, number] | null;
  target: [number, number, number] | null;
}

interface Node {
  obj: SceneObject;
  mesh: MeshShape | undefined;
  built: Built;
}

interface PeerView {
  boxes: THREE.Box3Helper[];
  marker: THREE.Group;
  label: CSS2DObject;
}

export interface ViewportEvents {
  /** The camera moved (debounced by the caller). */
  onCamera?: (camera: THREE.Vector3, target: THREE.Vector3) => void;
  /** A right click on the canvas, for the context menu. */
  onContextMenu?: (x: number, y: number) => void;
}

const SELECT_COLOR = new THREE.Color("#ffa033");
const VERTEX_COLOR = new THREE.Color("#101010");
const VERTEX_SELECTED = new THREE.Color("#ff9a1f");
const CLICK_SLOP = 4;

/**
 * Everything drawn in the 3D view, and every pointer gesture in it.
 *
 * It reads the editor store and draws it, diffing object by object so a poll
 * that changed nothing rebuilds nothing, and it writes back only through the
 * store's actions: `select`, `preview` for the frames of a drag and `commit`
 * at the end of one. React owns the panels around it; this owns the canvas.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private perspective: THREE.PerspectiveCamera;
  private orthographic: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private readonly controls: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly gizmoHelper: THREE.Object3D;
  private readonly pivot = new THREE.Object3D();
  private viewHelper: ViewHelper;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly outline: OutlinePass;
  private readonly labels = new CSS2DRenderer();
  private readonly grid = new THREE.Group();
  private readonly studio = new THREE.Group();
  private readonly ambient = new THREE.AmbientLight("#ffffff", 0.35);
  private readonly envMap: THREE.Texture;
  private readonly nodes = new Map<string, Node>();
  private readonly peers = new Map<string, PeerView>();
  private peerData: Peer[] = [];
  private editPoints: THREE.Points | null = null;
  private editWire: THREE.LineSegments | null = null;
  private editFor: { id: string; mesh: MeshShape | undefined } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly timer = new THREE.Timer();
  private readonly resize: ResizeObserver;
  private readonly unsubscribe: () => void;
  private dirty = true;
  private disposed = false;
  private gesture: {
    pivotStart: THREE.Matrix4;
    starts: Map<string, { world: THREE.Matrix4; parentInverse: THREE.Matrix4 }>;
    vertexStarts?: { id: string; world: THREE.Matrix4; inverse: THREE.Matrix4; base: MeshShape; picks: number[] };
    before: ReturnType<EditorState["snapshot"]>;
  } | null = null;
  private pointerDown: { x: number; y: number; button: number; shift: boolean; ctrl: boolean } | null = null;
  private box: HTMLDivElement;
  private ctrlHeld = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewportEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping — Blender's "Standard" view. A modeller has to show the
    // colour you picked as that colour: ACES and Neutral both apply a toe that
    // crushes dark values and shifts their hue (#24262b came out navy).
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "viewport-canvas";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.labels.domElement.className = "viewport-labels";
    container.appendChild(this.labels.domElement);

    this.box = document.createElement("div");
    this.box.className = "box-select";
    container.appendChild(this.box);

    const { width, height } = this.size();
    this.perspective = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
    this.perspective.position.set(6, 4.5, 7.5);
    this.orthographic = new THREE.OrthographicCamera(-5, 5, 5, -5, -1000, 1000);
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.perspective, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0.5, 0);
    // Middle-drag orbits, as in Blender, so the Select tool (whose left drag is
    // a box) can still turn the view; the wheel zooms.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.addEventListener("change", () => {
      this.dirty = true;
      this.events.onCamera?.(this.camera.position, this.controls.target);
    });

    this.gizmo = new TransformControls(this.perspective, this.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(this.gizmoHelper);
    this.scene.add(this.pivot);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.gizmo.addEventListener("mouseDown", () => this.beginGesture());
    this.gizmo.addEventListener("objectChange", () => this.moveGesture());
    this.gizmo.addEventListener("mouseUp", () => this.endGesture());
    this.gizmo.addEventListener("change", () => (this.dirty = true));

    this.viewHelper = this.makeViewHelper();

    // ── lighting ──
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

    // ── post ──
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.outline = new OutlinePass(new THREE.Vector2(width, height), this.scene, this.camera);
    this.outline.visibleEdgeColor.copy(SELECT_COLOR);
    this.outline.hiddenEdgeColor.set("#7a4a14");
    this.outline.edgeStrength = 4;
    this.outline.edgeThickness = 1;
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    this.raycaster.params.Line = { threshold: 0.06 };

    // ── input ──
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);

    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(container);
    this.onResize();

    this.unsubscribe = useEditor.subscribe((state, prev) => this.sync(state, prev));
    this.sync(useEditor.getState(), undefined);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.unsubscribe();
    this.resize.disconnect();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("contextmenu", this.onContextMenu);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    this.viewHelper.dispose();
    for (const node of this.nodes.values()) disposeObject(node.built.group);
    this.clearEditOverlay();
    this.envMap.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
    this.labels.domElement.remove();
    this.box.remove();
  }

  // ── public API ────────────────────────────────────────────────────────────

  setPeers(peers: Peer[]): void {
    this.peerData = peers;
    this.syncPeers();
  }

  /** Point the camera at the selection (or everything), framing it. */
  frameSelection(selectionOnly = true): void {
    const state = useEditor.getState();
    const ids = selectionOnly && state.selection.length ? state.selection : [...state.objects.keys()];
    const box = new THREE.Box3();
    for (const id of ids) {
      const b = this.worldBox(id);
      if (b) box.union(b);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.25);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const distance = radius / Math.sin((this.perspective.fov * Math.PI) / 360) * 1.15;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    if (this.camera === this.orthographic) this.fitOrtho(distance);
    this.controls.update();
    this.dirty = true;
  }

  /** Look from a fixed direction: `front`, `back`, `right`, `left`, `top`, `bottom`. */
  view(direction: "front" | "back" | "right" | "left" | "top" | "bottom"): void {
    const dirs: Record<string, [number, number, number]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
    };
    const d = new THREE.Vector3(...dirs[direction]!).normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(d, distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.dirty = true;
  }

  /** Move the camera to where a peer is looking from. */
  lookFrom(camera: [number, number, number], target: [number, number, number]): void {
    this.controls.target.set(...target);
    this.camera.position.set(...camera);
    this.controls.update();
    this.dirty = true;
  }

  /** Where new objects appear: under the point the camera orbits, on the ground. */
  cursor(): THREE.Vector3 {
    const t = this.controls.target;
    return new THREE.Vector3(round2(t.x), 0, round2(t.z));
  }

  /** The world-space bounds of an object and its children, or null if it draws nothing. */
  worldBox(id: string): THREE.Box3 | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.built.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    node.built.group.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry && !c.userData.helper && !isInHelper(c)) {
        mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
        box.union(b);
      }
    });
    if (box.isEmpty()) {
      const p = new THREE.Vector3().setFromMatrixPosition(node.built.group.matrixWorld);
      box.expandByPoint(p.clone().addScalar(-0.25)).expandByPoint(p.clone().addScalar(0.25));
    }
    return box;
  }

  /** The current frame as a PNG, without grid, gizmo, outlines or helpers. */
  async capture(): Promise<Blob | null> {
    const hidden: THREE.Object3D[] = [this.grid, this.gizmoHelper];
    for (const node of this.nodes.values()) if (node.built.helper) hidden.push(node.built.helper);
    if (this.editPoints) hidden.push(this.editPoints);
    if (this.editWire) hidden.push(this.editWire);
    for (const p of this.peers.values()) hidden.push(p.marker, ...p.boxes);
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const selected = this.outline.selectedObjects;
    this.outline.selectedObjects = [];
    this.composer.render();
    const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, "image/png"));
    hidden.forEach((o, i) => (o.visible = was[i]!));
    this.outline.selectedObjects = selected;
    this.dirty = true;
    return blob;
  }

  // ── store → scene ─────────────────────────────────────────────────────────

  private sync(state: EditorState, prev: EditorState | undefined): void {
    if (this.disposed) return;
    if (!prev || state.objects !== prev.objects || state.meshes !== prev.meshes) this.syncObjects(state);
    if (!prev || state.environment !== prev.environment) {
      this.scene.background = new THREE.Color(state.environment.background);
      this.ambient.color.set(state.environment.ambient_color);
      this.ambient.intensity = state.environment.ambient_intensity;
    }
    if (!prev || state.shading !== prev.shading || state.objects !== prev.objects) this.applyShading(state);
    if (!prev || state.showGrid !== prev.showGrid) this.grid.visible = state.showGrid;
    if (!prev || state.ortho !== prev.ortho) this.setOrtho(state.ortho);
    if (
      !prev ||
      state.selection !== prev.selection ||
      state.objects !== prev.objects ||
      state.tool !== prev.tool ||
      state.space !== prev.space ||
      state.snap !== prev.snap ||
      state.mode !== prev.mode ||
      state.meshes !== prev.meshes ||
      state.vertexSelection !== prev.vertexSelection ||
      state.role !== prev.role
    ) {
      this.syncSelection(state);
    }
    if (!prev || state.tool !== prev.tool) {
      // The select tool's left drag is a box; every other tool's orbits.
      this.controls.mouseButtons.LEFT = (state.tool === "select" ? -1 : THREE.MOUSE.ROTATE) as THREE.MOUSE;
    }
    this.dirty = true;
  }

  private syncObjects(state: EditorState): void {
    const children = childrenIndex(state.objects);
    const wanted = new Set(state.objects.keys());
    for (const [id, node] of this.nodes) {
      if (!wanted.has(id)) {
        // Children that survive their parent (they read as roots) are lifted
        // out first: disposing the group walks everything still under it.
        for (const child of [...node.built.group.children]) {
          if (child.userData.id && child.userData.id !== id) this.root.add(child);
        }
        if (this.editFor?.id === id) this.clearEditOverlay();
        node.built.group.removeFromParent();
        disposeObject(node.built.group);
        this.nodes.delete(id);
      }
    }
    // Rebuild what changed; reuse the rest.
    for (const obj of state.objects.values()) {
      const mesh = state.meshes.get(obj.id)?.shape;
      const node = this.nodes.get(obj.id);
      if (node && node.obj === obj && node.mesh === mesh) continue;
      if (node && this.canPatch(node, obj, mesh)) {
        this.patch(node, obj);
        node.obj = obj;
        continue;
      }
      const built = buildObject(obj, mesh);
      if (this.editFor?.id === obj.id) this.clearEditOverlay();
      if (node) {
        // Keep its children: they are moved across below.
        for (const child of [...node.built.group.children]) {
          if (child.userData.id && child.userData.id !== obj.id) built.group.add(child);
        }
        node.built.group.removeFromParent();
        disposeObject(node.built.body ?? new THREE.Object3D());
        if (node.built.helper) disposeObject(node.built.helper);
      }
      this.nodes.set(obj.id, { obj, mesh, built });
    }
    // Re-hang the hierarchy.
    const attach = (parentId: string, parent: THREE.Object3D) => {
      for (const o of children.get(parentId) ?? []) {
        const node = this.nodes.get(o.id)!;
        if (node.built.group.parent !== parent) parent.add(node.built.group);
        attach(o.id, node.built.group);
      }
    };
    attach("", this.root);
    this.scene.updateMatrixWorld(true);
  }

  /** Can the existing node take the new values in place, without rebuilding geometry? */
  private canPatch(node: Node, obj: SceneObject, mesh: MeshShape | undefined): boolean {
    // Transform, visibility and material changes are applied in place; a new
    // shape or a light (whose parts depend on its settings) is rebuilt.
    return node.obj.kind === obj.kind && node.obj.segments === obj.segments && node.mesh === mesh && !isLight(obj.kind);
  }

  private patch(node: Node, obj: SceneObject): void {
    const { group, body } = node.built;
    applyTransform(group, obj);
    group.visible = obj.visible;
    group.name = obj.name;
    const mesh = body as THREE.Mesh | null;
    if (mesh?.isMesh) {
      const prior = mesh.material as THREE.Material;
      mesh.material = standardMaterial(obj);
      prior.dispose();
      mesh.name = obj.name;
    }
  }

  private applyShading(state: EditorState): void {
    const shading = state.shading;
    const rendered = shading === "material";
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
      const mesh = body as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.wireframe = shading === "wireframe" || node.obj.material.wireframe;
      material.envMapIntensity = rendered ? 1 : 0;
      material.needsUpdate = true;
    }
  }

  // ── selection, gizmo, edit overlay ────────────────────────────────────────

  private syncSelection(state: EditorState): void {
    const selected: THREE.Object3D[] = [];
    for (const id of state.selection) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const target = node.built.body && !(node.built.body as THREE.Light).isLight ? node.built.body : node.built.helper;
      if (target) selected.push(target);
    }
    this.outline.selectedObjects = state.mode === "edit" ? [] : selected;

    if (state.mode === "edit") this.syncEditOverlay(state);
    else this.clearEditOverlay();

    if (this.gesture) return; // the pivot is being dragged; do not move it from under the hand
    const canTransform = state.canEdit() && state.tool !== "select";
    const gizmoMode = state.tool === "rotate" ? "rotate" : state.tool === "scale" ? "scale" : "translate";
    this.gizmo.setMode(gizmoMode);
    this.gizmo.setSpace(state.space);
    this.applySnap(state.snap || this.ctrlHeld);

    if (!canTransform) {
      this.gizmo.detach();
      return;
    }
    if (state.mode === "edit") {
      const center = this.vertexCenter(state);
      if (!center) {
        this.gizmo.detach();
        return;
      }
      this.pivot.position.copy(center);
      this.pivot.quaternion.identity();
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrixWorld(true);
      this.gizmo.attach(this.pivot);
      return;
    }
    const ids = topmost(state.selection, state.objects).filter((id) => this.nodes.has(id));
    if (!ids.length) {
      this.gizmo.detach();
      return;
    }
    if (ids.length === 1) {
      const g = this.nodes.get(ids[0]!)!.built.group;
      g.updateWorldMatrix(true, false);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      g.matrixWorld.decompose(p, q, s);
      this.pivot.position.copy(p);
      this.pivot.quaternion.copy(q);
    } else {
      const c = new THREE.Vector3();
      for (const id of ids) {
        const g = this.nodes.get(id)!.built.group;
        g.updateWorldMatrix(true, false);
        c.add(new THREE.Vector3().setFromMatrixPosition(g.matrixWorld));
      }
      this.pivot.position.copy(c.divideScalar(ids.length));
      this.pivot.quaternion.identity();
    }
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    this.gizmo.attach(this.pivot);
  }

  private applySnap(on: boolean): void {
    this.gizmo.setTranslationSnap(on ? 0.25 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.1 : null);
  }

  private editTarget(state: EditorState): { obj: SceneObject; node: Node; shape: MeshShape } | null {
    const obj = activeObject(state);
    if (!obj || obj.kind !== "mesh") return null;
    const node = this.nodes.get(obj.id);
    const shape = state.meshes.get(obj.id)?.shape;
    if (!node || !shape) return null;
    return { obj, node, shape };
  }

  private syncEditOverlay(state: EditorState): void {
    const target = this.editTarget(state);
    if (!target) {
      this.clearEditOverlay();
      return;
    }
    const { obj, node, shape } = target;
    if (!this.editFor || this.editFor.id !== obj.id || this.editFor.mesh !== shape) {
      this.clearEditOverlay();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(shape.positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(shape.positions.length), 3));
      this.editPoints = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }),
      );
      this.editPoints.renderOrder = 10;
      this.editPoints.userData.edit = true;
      const wire = new THREE.WireframeGeometry(geometryFromShape(shape));
      this.editWire = new THREE.LineSegments(
        wire,
        new THREE.LineBasicMaterial({ color: "#1a1a1a", transparent: true, opacity: 0.55, depthTest: true }),
      );
      this.editWire.renderOrder = 9;
      node.built.group.add(this.editPoints, this.editWire);
      this.editFor = { id: obj.id, mesh: shape };
    }
    const colors = this.editPoints!.geometry.getAttribute("color") as THREE.BufferAttribute;
    const n = shape.positions.length / 3;
    for (let i = 0; i < n; i += 1) {
      const c = state.vertexSelection.has(i) ? VERTEX_SELECTED : VERTEX_COLOR;
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
  }

  private clearEditOverlay(): void {
    for (const o of [this.editPoints, this.editWire]) {
      if (!o) continue;
      o.removeFromParent();
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.editPoints = null;
    this.editWire = null;
    this.editFor = null;
  }

  private vertexCenter(state: EditorState): THREE.Vector3 | null {
    const target = this.editTarget(state);
    if (!target || state.vertexSelection.size === 0) return null;
    const { node, shape } = target;
    node.built.group.updateWorldMatrix(true, false);
    const c = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const i of state.vertexSelection) {
      c.add(v.set(shape.positions[i * 3]!, shape.positions[i * 3 + 1]!, shape.positions[i * 3 + 2]!));
    }
    return c.divideScalar(state.vertexSelection.size).applyMatrix4(node.built.group.matrixWorld);
  }

  // ── gestures: one drag is one preview stream and one commit ───────────────

  private beginGesture(): void {
    const state = useEditor.getState();
    this.pivot.updateMatrixWorld(true);
    if (state.mode === "edit") {
      const target = this.editTarget(state);
      if (!target) return;
      const world = target.node.built.group.matrixWorld.clone();
      this.gesture = {
        pivotStart: this.pivot.matrixWorld.clone(),
        starts: new Map(),
        vertexStarts: {
          id: target.obj.id,
          world,
          inverse: world.clone().invert(),
          base: target.shape,
          picks: [...state.vertexSelection],
        },
        before: state.snapshot([], [target.obj.id]),
      };
      return;
    }
    const ids = topmost(state.selection, state.objects).filter((id) => this.nodes.has(id));
    const starts = new Map<string, { world: THREE.Matrix4; parentInverse: THREE.Matrix4 }>();
    for (const id of ids) {
      const g = this.nodes.get(id)!.built.group;
      g.updateWorldMatrix(true, false);
      const parentWorld = g.parent ? g.parent.matrixWorld.clone() : new THREE.Matrix4();
      starts.set(id, { world: g.matrixWorld.clone(), parentInverse: parentWorld.invert() });
    }
    this.gesture = { pivotStart: this.pivot.matrixWorld.clone(), starts, before: state.snapshot(ids) };
  }

  private gestureDelta(): THREE.Matrix4 {
    this.pivot.updateMatrixWorld(true);
    return this.pivot.matrixWorld.clone().multiply(this.gesture!.pivotStart.clone().invert());
  }

  private moveGesture(): void {
    if (!this.gesture) return;
    const delta = this.gestureDelta();
    const state = useEditor.getState();
    const vs = this.gesture.vertexStarts;
    if (vs) {
      const positions = vs.base.positions.slice();
      const v = new THREE.Vector3();
      // world-space delta, applied to each picked vertex and taken back into
      // the object's own space.
      const m = vs.inverse.clone().multiply(delta).multiply(vs.world);
      for (const i of vs.picks) {
        v.set(vs.base.positions[i * 3]!, vs.base.positions[i * 3 + 1]!, vs.base.positions[i * 3 + 2]!).applyMatrix4(m);
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
      }
      state.preview([], [{ id: vs.id, shape: { positions, indices: vs.base.indices } }]);
      return;
    }
    const moved: SceneObject[] = [];
    for (const [id, start] of this.gesture.starts) {
      const obj = state.objects.get(id);
      if (!obj) continue;
      const local = start.parentInverse.clone().multiply(delta).multiply(start.world);
      moved.push(withMatrix(obj, local));
    }
    state.preview(moved);
  }

  private endGesture(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    const state = useEditor.getState();
    const vs = gesture.vertexStarts;
    const tool = state.tool === "rotate" ? "Rotate" : state.tool === "scale" ? "Scale" : "Move";
    if (vs) {
      const shape = state.meshes.get(vs.id)?.shape;
      if (shape && shape !== vs.base) {
        const rounded = { positions: shape.positions.map((x) => Math.round(x * 1e5) / 1e5), indices: shape.indices };
        state.commit({ puts: [], deletes: [], meshes: [{ id: vs.id, shape: rounded }] }, `${tool} vertices`, gesture.before);
      }
    } else {
      const puts = [...gesture.starts.keys()].map((id) => state.objects.get(id)).filter((o): o is SceneObject => !!o);
      state.commit({ puts, deletes: [], meshes: [] }, tool, gesture.before);
    }
    this.syncSelection(useEditor.getState());
  }

  // ── pointer: click to pick, drag to box-select ────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.renderer.domElement.focus();
    if (this.viewHelper.handleClick(e)) {
      this.dirty = true;
      return;
    }
    // A press on a gizmo handle belongs to the gizmo.
    if (this.gizmo.axis !== null) return;
    this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const down = this.pointerDown;
    if (!down || down.button !== 0) return;
    if (useEditor.getState().tool !== "select") return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x1 = Math.min(down.x, e.clientX) - rect.left;
    const y1 = Math.min(down.y, e.clientY) - rect.top;
    const w = Math.abs(e.clientX - down.x);
    const h = Math.abs(e.clientY - down.y);
    if (w < CLICK_SLOP && h < CLICK_SLOP) return;
    Object.assign(this.box.style, { display: "block", left: `${x1}px`, top: `${y1}px`, width: `${w}px`, height: `${h}px` });
  };

  private onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    this.box.style.display = "none";
    if (!down || down.button !== 0 || this.gesture) return;
    const moved = Math.abs(e.clientX - down.x) > CLICK_SLOP || Math.abs(e.clientY - down.y) > CLICK_SLOP;
    const mode = down.shift ? "toggle" : down.ctrl ? "add" : "replace";
    if (!moved) {
      this.click(e, mode);
    } else if (useEditor.getState().tool === "select") {
      this.boxSelect(down.x, down.y, e.clientX, e.clientY, mode === "toggle" ? "add" : mode);
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.events.onContextMenu?.(e.clientX, e.clientY);
  };

  private onKey = (e: KeyboardEvent): void => {
    const held = e.ctrlKey || e.metaKey;
    if (held !== this.ctrlHeld) {
      this.ctrlHeld = held;
      this.applySnap(useEditor.getState().snap || held);
    }
  };

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private click(e: PointerEvent, mode: "replace" | "add" | "toggle"): void {
    const state = useEditor.getState();
    this.raycaster.setFromCamera(this.ndc(e.clientX, e.clientY), this.camera);
    if (state.mode === "edit" && this.editPoints) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      this.raycaster.params.Points = { threshold: distance * 0.012 };
      const hits = this.raycaster.intersectObject(this.editPoints, false);
      if (hits.length) {
        // Hits come nearest-first: the vertex under the pointer closest to the camera.
        const index = hits[0]!.index!;
        const next = mode === "replace" ? new Set<number>() : new Set(state.vertexSelection);
        if (mode === "toggle" && next.has(index)) next.delete(index);
        else next.add(index);
        state.setVertexSelection(next);
      } else if (mode === "replace") {
        state.setVertexSelection(new Set());
      }
      return;
    }
    const pickables: THREE.Object3D[] = [];
    for (const node of this.nodes.values()) {
      if (!isShown(node.built.group)) continue;
      if (node.built.body && (node.built.body as THREE.Mesh).isMesh) pickables.push(node.built.body);
      if (node.built.helper) pickables.push(node.built.helper);
    }
    const hits = this.raycaster.intersectObjects(pickables, true);
    const id = hits.find((h) => h.object.userData.id)?.object.userData.id as string | undefined;
    if (id) state.select([id], mode);
    else if (mode === "replace") state.select([]);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, mode: "replace" | "add"): void {
    const a = this.ndc(Math.min(x0, x1), Math.max(y0, y1));
    const b = this.ndc(Math.max(x0, x1), Math.min(y0, y1));
    const inside = (p: THREE.Vector3) => p.z < 1 && p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y;
    const state = useEditor.getState();
    const v = new THREE.Vector3();
    if (state.mode === "edit") {
      const target = this.editTarget(state);
      if (!target) return;
      const world = target.node.built.group.matrixWorld;
      const next = mode === "add" ? new Set(state.vertexSelection) : new Set<number>();
      const p = target.shape.positions;
      for (let i = 0; i < p.length / 3; i += 1) {
        v.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!).applyMatrix4(world).project(this.camera);
        if (inside(v)) next.add(i);
      }
      state.setVertexSelection(next);
      return;
    }
    const ids: string[] = [];
    for (const [id, node] of this.nodes) {
      if (!isShown(node.built.group)) continue;
      const box = this.worldBox(id);
      if (!box) continue;
      box.getCenter(v).project(this.camera);
      if (inside(v)) ids.push(id);
    }
    state.select(ids, mode);
  }

  // ── peers ─────────────────────────────────────────────────────────────────

  private syncPeers(): void {
    const seen = new Set<string>();
    for (const peer of this.peerData) {
      seen.add(peer.key);
      let view = this.peers.get(peer.key);
      if (!view) {
        const marker = new THREE.Group();
        const cone = new THREE.ConeGeometry(0.18, 0.35, 4, 1, true);
        cone.rotateX(-Math.PI / 2);
        cone.translate(0, 0, -0.175);
        marker.add(new THREE.LineSegments(new THREE.EdgesGeometry(cone), new THREE.LineBasicMaterial({ color: peer.color })));
        marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: peer.color })));
        const tag = document.createElement("div");
        tag.className = "peer-label";
        const label = new CSS2DObject(tag);
        label.position.set(0, 0.25, 0);
        marker.add(label);
        this.scene.add(marker);
        view = { boxes: [], marker, label };
        this.peers.set(peer.key, view);
      }
      view.label.element.textContent = peer.name;
      view.label.element.style.setProperty("--peer", peer.color);
      if (peer.camera && peer.target) {
        view.marker.visible = true;
        view.marker.position.set(...peer.camera);
        view.marker.lookAt(new THREE.Vector3(...peer.target));
      } else {
        view.marker.visible = false;
      }
      for (const b of view.boxes) {
        b.removeFromParent();
        b.geometry.dispose();
        (b.material as THREE.Material).dispose();
      }
      view.boxes = [];
      for (const id of peer.selection) {
        const box = this.worldBox(id);
        if (!box) continue;
        box.expandByScalar(0.03);
        const helper = new THREE.Box3Helper(box, new THREE.Color(peer.color));
        this.scene.add(helper);
        view.boxes.push(helper);
      }
    }
    for (const [key, view] of this.peers) {
      if (seen.has(key)) continue;
      view.marker.removeFromParent();
      view.label.element.remove();
      for (const b of view.boxes) b.removeFromParent();
      this.peers.delete(key);
    }
    this.dirty = true;
  }

  // ── camera & frame loop ───────────────────────────────────────────────────

  private makeViewHelper(): ViewHelper {
    const helper = new ViewHelper(this.camera, this.renderer.domElement);
    helper.location.top = 12;
    helper.location.right = 12;
    helper.location.bottom = null as unknown as number;
    helper.setLabels("X", "Y", "Z");
    helper.center = this.controls.target;
    return helper;
  }

  private setOrtho(on: boolean): void {
    const next = on ? this.orthographic : this.perspective;
    if (next === this.camera) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    this.camera = next;
    if (on) this.fitOrtho(distance);
    this.controls.object = next;
    this.gizmo.camera = next;
    this.renderPass.camera = next;
    this.outline.renderCamera = next;
    this.viewHelper.dispose();
    this.viewHelper = this.makeViewHelper();
    this.controls.update();
    this.dirty = true;
  }

  private fitOrtho(distance: number): void {
    const { width, height } = this.size();
    const h = distance * Math.tan((this.perspective.fov * Math.PI) / 360);
    const w = h * (width / height);
    Object.assign(this.orthographic, { left: -w, right: w, top: h, bottom: -h, zoom: 1 });
    this.orthographic.updateProjectionMatrix();
  }

  private size(): { width: number; height: number } {
    return { width: Math.max(1, this.container.clientWidth), height: Math.max(1, this.container.clientHeight) };
  }

  private onResize(): void {
    const { width, height } = this.size();
    this.renderer.setSize(width, height);
    this.labels.setSize(width, height);
    this.composer.setSize(width, height);
    this.outline.setSize(width, height);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    if (this.camera === this.orthographic) {
      this.fitOrtho(this.camera.position.distanceTo(this.controls.target));
    }
    this.dirty = true;
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

  private tick(): void {
    this.timer.update();
    const delta = this.timer.getDelta();
    if (this.viewHelper.animating) {
      this.viewHelper.update(delta);
      this.dirty = true;
      if (!this.viewHelper.animating) this.events.onCamera?.(this.camera.position, this.controls.target);
    }
    if (this.controls.update(delta)) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    // Peer selection boxes follow the objects they wrap.
    if (this.peerData.some((p) => p.selection.length)) this.refreshPeerBoxes();
    this.composer.render();
    this.renderer.autoClear = false;
    this.viewHelper.render(this.renderer);
    this.renderer.autoClear = true;
    this.labels.render(this.scene, this.camera);
    // The first frame of a loaded scene compiles every shader it uses, which
    // under software GL (CI, a VM) can stall for seconds. Tests wait for this
    // rather than racing it.
    if (!this.container.dataset.ready && useEditor.getState().loaded) this.container.dataset.ready = "true";
  }

  private refreshPeerBoxes(): void {
    for (const peer of this.peerData) {
      const view = this.peers.get(peer.key);
      if (!view) continue;
      let i = 0;
      for (const id of peer.selection) {
        const box = this.worldBox(id);
        const helper = view.boxes[i];
        if (!box || !helper) continue;
        helper.box.copy(box.expandByScalar(0.03));
        i += 1;
      }
    }
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function isInHelper(o: THREE.Object3D): boolean {
  let at: THREE.Object3D | null = o;
  while (at) {
    if (at.userData.helper || at.userData.edit) return true;
    at = at.parent;
  }
  return false;
}

/** Visible all the way up — a hidden parent hides its children. */
function isShown(o: THREE.Object3D): boolean {
  let at: THREE.Object3D | null = o;
  while (at) {
    if (!at.visible) return false;
    at = at.parent;
  }
  return true;
}
