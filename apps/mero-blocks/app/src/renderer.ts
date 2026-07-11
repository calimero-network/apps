// Three.js renderer. Lighting is fully baked into vertex attributes by the
// mesher; the only per-frame lighting input is the day/night factor uniform,
// so time passing never forces a remesh.

import * as THREE from "three";
import { MeshData } from "./engine/mesher";
import { EYE_HEIGHT } from "./engine/physics";

const VERT = /* glsl */ `
  attribute vec3 acolor;
  attribute vec2 alight;
  varying vec3 vColor;
  varying vec2 vLight;
  void main() {
    vColor = acolor;
    vLight = alight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float dayFactor;
  uniform float opacity;
  varying vec3 vColor;
  varying vec2 vLight;
  void main() {
    float l = max(vLight.x * dayFactor, vLight.y);
    float b = 0.10 + 0.90 * pow(l, 1.15);
    gl_FragColor = vec4(vColor * b, opacity);
  }
`;

function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55).getHex();
}

function nameSprite(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 30px system-ui";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 16), 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.2;
  return sprite;
}

export class GameRenderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  private opaqueMat: THREE.ShaderMaterial;
  private translucentMat: THREE.ShaderMaterial;
  private chunkMeshes = new Map<string, THREE.Mesh[]>();
  private avatars = new Map<string, THREE.Group>();
  private highlight: THREE.LineSegments;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
    this.scene.fog = new THREE.Fog(0x87c4eb, 60, 180);

    const uniforms = () => ({ dayFactor: { value: 1 }, opacity: { value: 1 } });
    this.opaqueMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms(),
    });
    this.translucentMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { dayFactor: { value: 1 }, opacity: { value: 0.65 } },
      transparent: true,
      depthWrite: false,
    });

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildGeometry(data: MeshData): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute("acolor", new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute("alight", new THREE.BufferAttribute(data.light, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return geo;
  }

  updateChunk(key: string, opaque: MeshData, translucent: MeshData): void {
    const old = this.chunkMeshes.get(key);
    if (old) {
      for (const m of old) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const meshes: THREE.Mesh[] = [];
    if (opaque.faceCount > 0) meshes.push(new THREE.Mesh(this.buildGeometry(opaque), this.opaqueMat));
    if (translucent.faceCount > 0)
      meshes.push(new THREE.Mesh(this.buildGeometry(translucent), this.translucentMat));
    for (const m of meshes) this.scene.add(m);
    this.chunkMeshes.set(key, meshes);
  }

  setDay(dayFactor: number, sky: [number, number, number]): void {
    this.opaqueMat.uniforms.dayFactor.value = dayFactor;
    this.translucentMat.uniforms.dayFactor.value = dayFactor;
    const c = new THREE.Color(sky[0], sky[1], sky[2]);
    this.scene.background = c;
    (this.scene.fog as THREE.Fog).color = c;
  }

  setCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y + EYE_HEIGHT, z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch);
  }

  setHighlight(pos: { x: number; y: number; z: number } | null): void {
    if (!pos) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
  }

  upsertAvatar(id: string, name: string): THREE.Group {
    let g = this.avatars.get(id);
    if (g) return g;
    g = new THREE.Group();
    const color = hashColor(id);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.2, 0.35),
      new THREE.MeshBasicMaterial({ color }),
    );
    body.position.y = 0.6;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xf1c78f }),
    );
    head.position.y = 1.55;
    g.add(body, head, nameSprite(name || id.slice(0, 8)));
    this.scene.add(g);
    this.avatars.set(id, g);
    return g;
  }

  moveAvatar(id: string, x: number, y: number, z: number, yaw: number): void {
    const g = this.avatars.get(id);
    if (!g) return;
    g.position.set(x, y, z);
    g.rotation.y = yaw;
  }

  removeAvatar(id: string): void {
    const g = this.avatars.get(id);
    if (!g) return;
    this.scene.remove(g);
    this.avatars.delete(id);
  }

  avatarIds(): string[] {
    return [...this.avatars.keys()];
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
