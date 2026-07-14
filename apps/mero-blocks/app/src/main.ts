// mero-blocks entry point: session bootstrap, connect screen, game loop.

import { AIR, blockDef, HOTBAR, WATER } from "./engine/blocks";
import { LightGrid } from "./engine/lighting";
import { buildChunkMesh } from "./engine/mesher";
import {
  blockIntersectsPlayer,
  PlayerState,
  stepPlayer,
  TICK,
} from "./engine/physics";
import { raycast } from "./engine/raycast";
import { dayFactor, skyColor } from "./engine/sim";
import { generateWorld, spawnPoint } from "./engine/terrain";
import { WorldStore, WORLD_CX, WORLD_CY, WORLD_CZ, chunkKey } from "./engine/world";
import { createWorldInvite } from "./net/admin";
import { GameClient } from "./net/client";
import { captureSessionFromHash, getSession, hasConnection } from "./net/session";
import { RemotePlayer, SyncEngine, Transform } from "./net/sync";
import { GameRenderer } from "./renderer";
import { loadWorld, saveWorld } from "./state/persistence";
import { Hud } from "./ui/hud";
import { Landing, LaunchChoice } from "./ui/landing";
import { PauseMenu, WorldMap } from "./ui/overlays";

const REACH = 6;
const EDIT_REPEAT_MS = 250;
const SAVE_MS = 5000;
const RELIGHT_FULL_THRESHOLD = 8;

interface RemoteAvatar {
  cur: { x: number; y: number; z: number; yaw: number };
  target: { x: number; y: number; z: number; yaw: number };
  name: string;
  sel: number;
}

async function boot(): Promise<void> {
  const captured = captureSessionFromHash();

  const app = document.getElementById("app")!;
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "game-canvas";
  app.appendChild(canvas);
  const hud = new Hud(app);

  const defaults = { name: localStorage.getItem("mb-name") ?? "Player", seed: 1337 };
  // Desktop SSO auto-enter: a full hash (tokens + context) means the desktop
  // already authenticated us — zero clicks, straight into the shared world.
  let choice: LaunchChoice;
  if (captured === "full" && hasConnection()) {
    choice = { name: defaults.name };
  } else {
    choice = await new Landing(app).show(defaults);
  }
  localStorage.setItem("mb-name", choice.name);

  // ---- world + net bootstrap -----------------------------------------
  // The landing only resolves once a node + world are connected; there is no
  // offline mode, so an unreachable world is a hard stop, not a fallback.
  const session = getSession();
  if (!hasConnection() || !session.contextId) {
    showFatal(app, "Lost the node connection — go back and connect again.");
    return;
  }
  const worldId = session.contextId;

  const client = new GameClient();
  let seed: number;
  let createdAt = Math.floor(Date.now() / 1000);
  try {
    const meta = await client.fetchWorldMeta();
    seed = meta.seed;
    createdAt = meta.createdAt || createdAt;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    showFatal(app, `Could not reach the shared world (${reason}).`);
    return;
  }

  const saved = loadWorld(worldId);

  const world = new WorldStore();
  generateWorld(world, seed);
  if (saved) world.applyOverridesJSON(saved.overrides);
  world.pendingRelights.length = 0; // initial state gets one full relight below

  const light = new LightGrid();
  light.recomputeAll(world);
  light.takeChangedChunks();

  const renderer = new GameRenderer(canvas);
  for (let cx = 0; cx < WORLD_CX; cx++)
    for (let cy = 0; cy < WORLD_CY; cy++)
      for (let cz = 0; cz < WORLD_CZ; cz++) {
        const mesh = buildChunkMesh(world, light, cx, cy, cz);
        renderer.updateChunk(chunkKey(cx, cy, cz), mesh.opaque, mesh.translucent);
      }
  world.takeDirty();

  // ---- player ----------------------------------------------------------
  const spawn = saved?.player ?? { ...spawnPoint(seed), yaw: 0, pitch: 0, sel: 0 };
  const player: PlayerState = {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    inWater: false,
  };
  let yaw = spawn.yaw ?? 0;
  let pitch = spawn.pitch ?? 0;
  let sel = spawn.sel ?? 0;

  hud.showGameHud();
  hud.setHotbarSel(sel);
  hud.setPlayers(choice.name, []);

  // ---- networking ------------------------------------------------------
  let sync: SyncEngine | null = null;
  let myId: string | null = null;
  const remotes = new Map<string, RemoteAvatar>();

  const onPlayers = (players: RemotePlayer[]) => {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      const existing = remotes.get(p.id);
      if (existing) {
        existing.target = target;
        existing.name = p.name;
        existing.sel = p.sel;
      } else {
        remotes.set(p.id, { cur: { ...target }, target, name: p.name, sel: p.sel });
        renderer.upsertAvatar(p.id, p.name);
      }
    }
    for (const id of [...remotes.keys()]) {
      if (!seen.has(id)) {
        remotes.delete(id);
        renderer.removeAvatar(id);
      }
    }
    hud.setPlayers(choice.name, players.map((p) => ({ name: p.name })));
  };

  myId = await client.resolveIdentity();
  sync = new SyncEngine(client.exec, world, () => myId, {
    onPlayers,
    onToast: (msg) => hud.toast(msg),
    onRemoteEdits: () => {
      /* chunks remesh via the dirty/relight pipeline automatically */
    },
  });
  client.subscribe((ev) => sync?.handleEvent(ev));
  try {
    await sync.join(choice.name);
    await sync.reconcile();
    hud.toast("Connected to shared world");
  } catch {
    hud.toast("Sync failed — edits will retry in the background");
  }

  // ---- overlays (Esc/O = game menu, M = map — trackpad-friendly) --------
  const options = new PauseMenu(app, {
    onLeave: () => {
      save();
      void sync?.leave();
      window.location.reload(); // back to the landing/launcher
    },
    onInvite: () => createWorldInvite(),
    onFovChange: (fov) => renderer.setFov(fov),
  });
  renderer.setFov(options.getFov()); // restore the player's FOV choice
  const worldMap = new WorldMap(app, world);
  const uiOpen = () => options.open || worldMap.open;

  // ---- input -----------------------------------------------------------
  const keys = new Set<string>();
  let breakHeld = false;
  let placeHeld = false;
  let editCooldown = 0;

  const openOverlay = (which: "options" | "map"): void => {
    document.exitPointerLock();
    keys.clear();
    breakHeld = false;
    placeHeld = false;
    if (which === "options") {
      worldMap.hide();
      options.toggle();
    } else {
      options.hide();
      worldMap.toggle();
    }
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyO") return openOverlay("options");
    if (e.code === "KeyM") return openOverlay("map");
    // Esc = Minecraft game menu: closes the map if it's up, otherwise
    // toggles the pause menu. (While pointer-locked the browser reserves
    // Esc for unlocking — the pointerlockchange handler below covers that.)
    if (e.code === "Escape") {
      if (worldMap.open) return worldMap.hide();
      return openOverlay("options");
    }
    if (uiOpen()) return; // menus swallow gameplay keys
    keys.add(e.code);
    // keyboard mining/placing — no mouse buttons needed on a trackpad
    if (e.code === "KeyQ" && !e.repeat) {
      breakHeld = true;
      editCooldown = 0;
    }
    if (e.code === "KeyE" && !e.repeat) {
      placeHeld = true;
      editCooldown = 0;
    }
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5)) - 1;
      if (n >= 0 && n < HOTBAR.length) {
        sel = n;
        hud.setHotbarSel(sel);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    if (e.code === "KeyQ") breakHeld = false;
    if (e.code === "KeyE") placeHeld = false;
  });
  window.addEventListener("wheel", (e) => {
    if (uiOpen()) return;
    sel = (sel + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
    hud.setHotbarSel(sel);
  });

  canvas.addEventListener("click", () => {
    if (uiOpen()) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    const unlocked = document.pointerLockElement !== canvas;
    hud.setHint(unlocked);
    // Esc while pointer-locked never reaches keydown (the browser reserves it
    // to unlock) — so losing the lock with no overlay up IS the Esc press:
    // open the game menu, exactly like Minecraft.
    if (unlocked && !uiOpen()) {
      keys.clear();
      breakHeld = false;
      placeHeld = false;
      options.toggle();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    const look = 0.0024 * options.getSensitivity();
    yaw -= e.movementX * look;
    pitch = Math.max(-1.55, Math.min(1.55, pitch - e.movementY * look));
  });
  window.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) breakHeld = true;
    if (e.button === 2) placeHeld = true;
    editCooldown = 0; // act immediately
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) breakHeld = false;
    if (e.button === 2) placeHeld = false;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  const lookDir = (): [number, number, number] => [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];

  const editBlock = (x: number, y: number, z: number, b: number): void => {
    if (!world.inBounds(x, y, z)) return;
    if (b === AIR && !blockDef(world.getBlock(x, y, z)).breakable) return;
    if (b !== AIR && blockDef(b).solid && blockIntersectsPlayer(player, x, y, z)) return;
    if (world.setBlock(x, y, z, b)) sync?.queueEdit(x, y, z, b);
  };

  const tryEdit = (): void => {
    const [dx, dy, dz] = lookDir();
    const eye = 1.62;
    const hit = raycast(world, player.x, player.y + eye, player.z, dx, dy, dz, REACH);
    renderer.setHighlight(hit);
    if (!hit || editCooldown > 0) return;
    if (breakHeld) {
      editBlock(hit.x, hit.y, hit.z, AIR);
      editCooldown = EDIT_REPEAT_MS;
    } else if (placeHeld) {
      const px = hit.x + hit.face[0],
        py = hit.y + hit.face[1],
        pz = hit.z + hit.face[2];
      const cur = world.getBlock(px, py, pz);
      if (cur === AIR || cur === WATER) {
        editBlock(px, py, pz, HOTBAR[sel]);
        editCooldown = EDIT_REPEAT_MS;
      }
    }
  };

  // ---- persistence ------------------------------------------------------
  const save = (): void => {
    saveWorld(worldId, {
      seed,
      name: choice.name,
      overrides: world.overridesToJSON(),
      player: { x: player.x, y: player.y, z: player.z, yaw, pitch, sel, name: choice.name },
      savedAt: Date.now(),
    });
  };
  window.addEventListener("beforeunload", () => {
    save();
    void sync?.leave();
  });

  // ---- frame/tick loop ---------------------------------------------------
  let last = performance.now();
  let physicsAcc = 0;
  let saveAcc = 0;
  let fps = 0;
  const meshBudgetPerFrame = 12;
  const pendingMesh = new Set<string>();

  const frame = (now: number): void => {
    const dtMs = Math.min(100, now - last);
    last = now;
    physicsAcc += dtMs / 1000;
    saveAcc += dtMs;
    editCooldown = Math.max(0, editCooldown - dtMs);
    fps = fps * 0.95 + (1000 / Math.max(1, dtMs)) * 0.05;

    // physics at fixed 60Hz (menus freeze movement, not the world)
    const menusOpen = uiOpen();
    const forward = menusOpen ? 0 : (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = menusOpen ? 0 : (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    // right vector is forward × up = (cos yaw, 0, -sin yaw) — the strafe Z
    // term must be NEGATIVE sin, or A/D mirror whenever you face ±X.
    const moveX = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
    const moveZ = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
    const moving = forward !== 0 || strafe !== 0;
    while (physicsAcc >= TICK) {
      stepPlayer(world, player, { moveX, moveZ, jump: !menusOpen && keys.has("Space") }, TICK);
      physicsAcc -= TICK;
    }

    if (menusOpen) renderer.setHighlight(null);
    else tryEdit();

    // relight edited columns (full recompute if a big batch arrived)
    if (world.pendingRelights.length > 0) {
      const relights = world.pendingRelights.splice(0);
      if (relights.length > RELIGHT_FULL_THRESHOLD) {
        light.recomputeAll(world);
      } else {
        for (const [x, z] of relights) light.relightAround(world, x, z);
      }
    }

    // remesh dirty chunks within a per-frame budget
    for (const key of world.takeDirty()) pendingMesh.add(key);
    for (const key of light.takeChangedChunks()) pendingMesh.add(key);
    let meshed = 0;
    for (const key of pendingMesh) {
      if (meshed++ >= meshBudgetPerFrame) break;
      const [cx, cy, cz] = key.split(",").map(Number);
      const mesh = buildChunkMesh(world, light, cx, cy, cz);
      renderer.updateChunk(key, mesh.opaque, mesh.translucent);
      pendingMesh.delete(key);
    }

    // networking
    const transform: Transform = {
      name: choice.name,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw,
      pitch,
      sel,
    };
    sync?.tick(dtMs, transform, moving);

    // remote avatars: lerp toward last known transform
    const lerp = Math.min(1, dtMs / 250);
    for (const [id, r] of remotes) {
      r.cur.x += (r.target.x - r.cur.x) * lerp;
      r.cur.y += (r.target.y - r.cur.y) * lerp;
      r.cur.z += (r.target.z - r.cur.z) * lerp;
      r.cur.yaw += (r.target.yaw - r.cur.yaw) * lerp;
      renderer.moveAvatar(id, r.cur.x, r.cur.y, r.cur.z, r.cur.yaw);
    }

    // live map: self + every remote player, interpolated like the avatars
    worldMap.update(
      dtMs,
      { x: player.x, z: player.z, yaw, name: choice.name, sel },
      [...remotes.values()].map((r) => ({
        x: r.cur.x,
        z: r.cur.z,
        yaw: r.cur.yaw,
        name: r.name,
        sel: r.sel,
      })),
    );

    // day/night from the shared world clock
    const elapsed = Date.now() / 1000 - createdAt;
    renderer.setDay(dayFactor(elapsed), skyColor(elapsed));

    renderer.setCamera(player.x, player.y, player.z, yaw, pitch);
    renderer.render();

    hud.setDebug(
      `fps ${fps.toFixed(0)}  pos ${player.x.toFixed(1)},${player.y.toFixed(1)},${player.z.toFixed(1)}\n` +
        `chunk ${Math.floor(player.x / 16)},${Math.floor(player.y / 16)},${Math.floor(player.z / 16)}` +
        `  edits ${world.overrides.size}  peers ${remotes.size}\n` +
        `online${sync && sync.pending.size > 0 ? ` (${sync.pending.size} pending)` : ""}`,
    );

    if (saveAcc >= SAVE_MS) {
      saveAcc = 0;
      save();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // test/debug handle
  (window as unknown as Record<string, unknown>).__mb = {
    world,
    player,
    sync,
    editBlock,
    getOverrides: () => world.overridesToJSON(),
    input: () => ({ breakHeld, placeHeld, uiOpen: uiOpen() }),
  };
}

/** Online-only dead end: the world is unreachable — say why, offer the title screen. */
function showFatal(app: HTMLElement, message: string): void {
  const el = document.createElement("div");
  el.dataset.testid = "fatal-error";
  el.style.cssText =
    "position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:16px;background:#0b0e14;color:#fff;" +
    "font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px;";
  const msg = document.createElement("p");
  msg.dataset.testid = "fatal-message";
  msg.style.cssText = "margin:0;max-width:480px;font-size:15px;line-height:1.6;color:#cfd9e4;";
  msg.textContent = message;
  const btn = document.createElement("button");
  btn.dataset.testid = "back-to-title-btn";
  btn.textContent = "Back to title";
  btn.style.cssText =
    "padding:12px 28px;border-radius:5px;border:2px solid rgba(0,0,0,0.75);font-size:14px;" +
    "font-weight:700;cursor:pointer;color:#fff;background:#4f8cff;";
  btn.addEventListener("click", () => window.location.reload());
  el.append(msg, btn);
  app.appendChild(el);
}

void boot();
