// Mero Blocks, game only, for the iOS and Android apps.
//
// The app hosts this page in a WebView from files bundled into the app (nothing is fetched at
// run time). It reuses the web app's engine as it is: terrain, lighting, mesher, physics,
// raycast, the three.js renderer and the SyncEngine that talks to the contract. What changes is
// around it:
//   - no landing page, no node login, no world picker: the app signs in, picks the world and
//     sends `start` with it;
//   - the SyncEngine's `exec` is the native bridge (bridge.ts), so every contract call runs
//     through the app's session instead of mero-js;
//   - touch controls (controls.ts) instead of pointer lock, keyboard and mouse;
//   - `pause` / `resume` from the app when it goes to the background or opens its menu.

import { AIR, blockDef, HOTBAR, WATER } from "../../../app/src/engine/blocks";
import { LightGrid } from "../../../app/src/engine/lighting";
import { buildChunkMesh } from "../../../app/src/engine/mesher";
import { blockIntersectsPlayer, type PlayerState, stepPlayer, TICK } from "../../../app/src/engine/physics";
import { raycast } from "../../../app/src/engine/raycast";
import { dayFactor, skyColor } from "../../../app/src/engine/sim";
import { generateWorld, spawnPoint } from "../../../app/src/engine/terrain";
import { chunkKey, WORLD_CX, WORLD_CY, WORLD_CZ, WorldStore } from "../../../app/src/engine/world";
import { type RemotePlayer, SyncEngine, type Transform } from "../../../app/src/net/sync";
import { GameRenderer } from "../../../app/src/renderer";
import { loadWorld, saveWorld } from "../../../app/src/state/persistence";
import { type AppMessage, detectHost, type Insets, MeroBridge, type StartConfig } from "./bridge";
import { LOOK_PER_PX, TouchControls } from "./controls";

const REACH = 6;
const EDIT_REPEAT_MS = 250;
const SAVE_MS = 5000;
const CONNECT_RETRY_MS = 2000;
const RELIGHT_FULL_THRESHOLD = 8;
/** A world just joined answers "not synced yet" for a while; keep asking this long. */
const WORLD_READY_MS = 60_000;
const MESH_BUDGET_PER_FRAME = 8;

interface WorldMeta {
  name: string;
  seed: number;
  createdAt: number;
}

interface RemoteAvatar {
  cur: { x: number; y: number; z: number; yaw: number };
  target: { x: number; y: number; z: number; yaw: number };
}

let game: Game | null = null;
let started = false;

const bridge = new MeroBridge(detectHost(), (msg: AppMessage) => {
  switch (msg.type) {
    case "start":
      if (started) return;
      started = true;
      if (msg.insets) applyInsets(msg.insets);
      void boot(msg);
      break;
    case "event":
      game?.nudge();
      break;
    case "pause":
      game?.pause();
      break;
    case "resume":
      game?.resume();
      break;
    case "insets":
      applyInsets(msg);
      break;
    case "settings":
      if (game) game.sensitivity = clampSensitivity(msg.sensitivity);
      break;
  }
});

(window as unknown as { meroBridge: unknown }).meroBridge = {
  query: (method: string, args?: Record<string, unknown>) => bridge.query(method, args),
  execute: (method: string, args?: Record<string, unknown>) => bridge.execute(method, args),
  receive: (json: string) => bridge.receive(json),
};

function applyInsets(i: Insets): void {
  const s = document.documentElement.style;
  s.setProperty("--inset-top", `${i.top}px`);
  s.setProperty("--inset-left", `${i.left}px`);
  s.setProperty("--inset-bottom", `${i.bottom}px`);
  s.setProperty("--inset-right", `${i.right}px`);
}

const clampSensitivity = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  return Math.max(0.3, Math.min(3, n));
};

function setStatus(text: string | null): void {
  const el = document.getElementById("status")!;
  el.style.display = text ? "" : "none";
  if (text) el.querySelector("p")!.textContent = text;
}

async function fetchWorldMetaWhenReady(): Promise<WorldMeta> {
  const deadline = Date.now() + WORLD_READY_MS;
  for (;;) {
    try {
      return await bridge.query<WorldMeta>("world_meta", {});
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      setStatus("Syncing the world…");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function boot(cfg: StartConfig): Promise<void> {
  setStatus("Loading the world…");
  let meta: WorldMeta;
  try {
    meta = await fetchWorldMetaWhenReady();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    bridge.send("fatal", { message: `Could not open this world (${reason}).` });
    setStatus(null);
    return;
  }
  game = new Game(cfg, meta);
  setStatus(null);
  bridge.send("loaded");
}

class Game {
  sensitivity: number;
  private paused = false;
  private rafId = 0;
  private last = performance.now();
  private physicsAcc = 0;
  private saveAcc = 0;
  private editCooldown = 0;
  private pendingMesh = new Set<string>();

  private world = new WorldStore();
  private light = new LightGrid();
  private renderer: GameRenderer;
  private controls: TouchControls;
  private sync: SyncEngine;
  private remotes = new Map<string, RemoteAvatar>();
  private player: PlayerState;
  private yaw: number;
  private pitch: number;
  private sel: number;
  private readonly createdAt: number;
  private readonly seed: number;

  constructor(
    private cfg: StartConfig,
    meta: WorldMeta,
  ) {
    this.sensitivity = clampSensitivity(cfg.sensitivity);
    this.seed = meta.seed;
    this.createdAt = meta.createdAt || Math.floor(Date.now() / 1000);
    const saved = loadWorld(cfg.contextId);

    generateWorld(this.world, this.seed);
    if (saved) this.world.applyOverridesJSON(saved.overrides);
    this.world.pendingRelights.length = 0;
    this.light.recomputeAll(this.world);
    this.light.takeChangedChunks();

    const app = document.getElementById("app")!;
    const canvas = document.createElement("canvas");
    app.appendChild(canvas);
    this.renderer = new GameRenderer(canvas);
    // Phones: cap the backing store so a 3x screen does not render 9x the pixels.
    this.renderer.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.resize();
    this.renderer.setFov(80);
    for (let cx = 0; cx < WORLD_CX; cx++)
      for (let cy = 0; cy < WORLD_CY; cy++)
        for (let cz = 0; cz < WORLD_CZ; cz++) {
          const mesh = buildChunkMesh(this.world, this.light, cx, cy, cz);
          this.renderer.updateChunk(chunkKey(cx, cy, cz), mesh.opaque, mesh.translucent);
        }
    this.world.takeDirty();

    const spawn = saved?.player ?? { ...spawnPoint(this.seed), yaw: 0, pitch: 0, sel: 0 };
    this.player = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false };
    this.yaw = spawn.yaw ?? 0;
    this.pitch = spawn.pitch ?? 0;
    this.sel = Math.max(0, Math.min(HOTBAR.length - 1, spawn.sel ?? 0));

    this.controls = new TouchControls(app, {
      onSelect: (i) => {
        this.sel = i;
        this.controls.setSelected(i);
        bridge.send("haptic", { style: "selection" });
      },
      onMenu: () => bridge.send("menu"),
    });
    this.controls.setSelected(this.sel);

    const myId = cfg.myId;
    this.sync = new SyncEngine(bridge.exec, this.world, () => myId || null, {
      onPlayers: (players) => this.onPlayers(players),
      onToast: (msg) => this.controls.toast(msg),
    });
    void this.sync.connect(cfg.name, CONNECT_RETRY_MS).then((ok) => {
      if (ok) this.controls.toast(`Joined ${cfg.worldName || meta.name || "the world"}`);
    });

    this.rafId = requestAnimationFrame(this.frame);
  }

  /** A relay event for this world: something changed, read it now instead of at the next poll. */
  nudge(): void {
    if (this.paused) return;
    void this.sync.reconcile().catch(() => {});
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.controls.release();
    cancelAnimationFrame(this.rafId);
    this.save();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.last = performance.now();
    void this.sync.reconcile().catch(() => {});
    this.rafId = requestAnimationFrame(this.frame);
  }

  private onPlayers(players: RemotePlayer[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      const existing = this.remotes.get(p.id);
      if (existing) existing.target = target;
      else {
        this.remotes.set(p.id, { cur: { ...target }, target });
        this.renderer.upsertAvatar(p.id, p.name);
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) {
        this.remotes.delete(id);
        this.renderer.removeAvatar(id);
      }
    }
    this.controls.setPlayers(players.length + 1);
  }

  private lookDir(): [number, number, number] {
    return [
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
  }

  private editBlock(x: number, y: number, z: number, b: number): boolean {
    const w = this.world;
    if (!w.inBounds(x, y, z)) return false;
    if (b === AIR && !blockDef(w.getBlock(x, y, z)).breakable) return false;
    if (b !== AIR && blockDef(b).solid && blockIntersectsPlayer(this.player, x, y, z)) return false;
    if (!w.setBlock(x, y, z, b)) return false;
    this.sync.queueEdit(x, y, z, b);
    return true;
  }

  private tryEdit(): void {
    const c = this.controls;
    if (c.freshPress) {
      c.freshPress = false;
      this.editCooldown = 0;
    }
    const [dx, dy, dz] = this.lookDir();
    const p = this.player;
    const hit = raycast(this.world, p.x, p.y + 1.62, p.z, dx, dy, dz, REACH);
    this.renderer.setHighlight(hit);
    if (!hit || this.editCooldown > 0) return;
    let edited = false;
    if (c.breakHeld) {
      edited = this.editBlock(hit.x, hit.y, hit.z, AIR);
    } else if (c.placeHeld) {
      const px = hit.x + hit.face[0];
      const py = hit.y + hit.face[1];
      const pz = hit.z + hit.face[2];
      const cur = this.world.getBlock(px, py, pz);
      if (cur === AIR || cur === WATER) edited = this.editBlock(px, py, pz, HOTBAR[this.sel]);
    } else {
      return;
    }
    this.editCooldown = EDIT_REPEAT_MS;
    if (edited) bridge.send("haptic", { style: "light" });
  }

  private save(): void {
    const p = this.player;
    saveWorld(this.cfg.contextId, {
      seed: this.seed,
      name: this.cfg.name,
      overrides: this.world.overridesToJSON(),
      player: { x: p.x, y: p.y, z: p.z, yaw: this.yaw, pitch: this.pitch, sel: this.sel, name: this.cfg.name },
      savedAt: Date.now(),
    });
  }

  private frame = (now: number): void => {
    if (this.paused) return;
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    this.physicsAcc += dtMs / 1000;
    this.saveAcc += dtMs;
    this.editCooldown = Math.max(0, this.editCooldown - dtMs);

    const c = this.controls;
    const look = c.takeLook();
    const k = LOOK_PER_PX * this.sensitivity;
    this.yaw -= look.dx * k;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - look.dy * k));

    const forward = c.move.y;
    const strafe = c.move.x;
    // right = forward × up = (cos yaw, 0, -sin yaw), as in the web build
    const moveX = -Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe;
    const moveZ = -Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe;
    const moving = forward !== 0 || strafe !== 0;
    while (this.physicsAcc >= TICK) {
      stepPlayer(this.world, this.player, { moveX, moveZ, jump: c.jump }, TICK);
      this.physicsAcc -= TICK;
    }

    this.tryEdit();

    if (this.world.pendingRelights.length > 0) {
      const relights = this.world.pendingRelights.splice(0);
      if (relights.length > RELIGHT_FULL_THRESHOLD) this.light.recomputeAll(this.world);
      else for (const [x, z] of relights) this.light.relightAround(this.world, x, z);
    }
    for (const key of this.world.takeDirty()) this.pendingMesh.add(key);
    for (const key of this.light.takeChangedChunks()) this.pendingMesh.add(key);
    let meshed = 0;
    for (const key of this.pendingMesh) {
      if (meshed++ >= MESH_BUDGET_PER_FRAME) break;
      const [cx, cy, cz] = key.split(",").map(Number);
      const mesh = buildChunkMesh(this.world, this.light, cx, cy, cz);
      this.renderer.updateChunk(key, mesh.opaque, mesh.translucent);
      this.pendingMesh.delete(key);
    }

    const p = this.player;
    const transform: Transform = {
      name: this.cfg.name,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: this.yaw,
      pitch: this.pitch,
      sel: this.sel,
    };
    this.sync.tick(dtMs, transform, moving);

    const lerp = Math.min(1, dtMs / 250);
    for (const [id, r] of this.remotes) {
      r.cur.x += (r.target.x - r.cur.x) * lerp;
      r.cur.y += (r.target.y - r.cur.y) * lerp;
      r.cur.z += (r.target.z - r.cur.z) * lerp;
      r.cur.yaw += (r.target.yaw - r.cur.yaw) * lerp;
      this.renderer.moveAvatar(id, r.cur.x, r.cur.y, r.cur.z, r.cur.yaw);
    }

    const elapsed = Date.now() / 1000 - this.createdAt;
    this.renderer.setDay(dayFactor(elapsed), skyColor(elapsed));
    this.renderer.setCamera(p.x, p.y, p.z, this.yaw, this.pitch);
    this.renderer.render();

    if (this.saveAcc >= SAVE_MS) {
      this.saveAcc = 0;
      this.save();
    }
    this.rafId = requestAnimationFrame(this.frame);
  };
}

window.addEventListener("pagehide", () => game?.pause());
// Tell the app the page is listening; it answers with `start`.
bridge.send("ready");
