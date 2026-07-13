// merraria entry point: session bootstrap, connect screen, game loop.

import { LightGrid } from "./engine/lighting";
import { digTick, DigState, Inventory, place, withinReach } from "./engine/mining";
import { PlayerState, stepPlayer, TICK, tileIntersectsPlayer } from "./engine/physics";
import { dayFactor } from "./engine/sim";
import { generateWorld, spawnPoint } from "./engine/terrain";
import { AIR, HOTBAR, STARTING_INVENTORY } from "./engine/tiles";
import { TileStore } from "./engine/world";
import { GameClient } from "./net/client";
import { captureSessionFromHash, getSession, hasConnection } from "./net/session";
import { RemotePlayer, SyncEngine, Transform } from "./net/sync";
import { GameRenderer, RemoteDraw } from "./renderer";
import { loadWorld, saveWorld } from "./state/persistence";
import { Hud } from "./ui/hud";
import { Landing, LaunchChoice } from "./ui/landing";

const SAVE_MS = 5000;
const MINIMAP_MS = 500; // live map: remote miners move on it in near real time

interface RemoteAvatar {
  cur: { x: number; y: number; dir: number };
  target: { x: number; y: number; dir: number };
  name: string;
  action: string;
}

async function boot(): Promise<void> {
  const captured = captureSessionFromHash();

  const app = document.getElementById("app")!;
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "game-canvas";
  app.appendChild(canvas);
  const hud = new Hud(app);

  const defaults = { name: localStorage.getItem("mt-name") ?? "Player", seed: 1337 };
  // Desktop SSO auto-enter: a full hash (tokens + context) means the desktop
  // already authenticated us — zero clicks, straight into the shared world.
  let choice: LaunchChoice;
  if (captured === "full" && hasConnection()) {
    choice = { mode: "online", ...defaults };
  } else {
    choice = await new Landing(app).show(defaults);
  }
  localStorage.setItem("mt-name", choice.name);

  // ---- world + net bootstrap -----------------------------------------
  const online = choice.mode === "online" && hasConnection();
  const session = getSession();
  const worldId = online ? session.contextId! : "local";

  let client: GameClient | null = null;
  let seed = choice.seed;
  let createdAt = Math.floor(Date.now() / 1000);

  if (online) {
    client = new GameClient();
    try {
      const meta = await client.fetchWorldMeta();
      seed = meta.seed;
      createdAt = meta.createdAt || createdAt;
    } catch {
      hud.toast("Could not reach the shared world — playing offline");
      client = null;
    }
  }

  const saved = loadWorld(worldId);
  if (!online && saved) seed = saved.seed;

  const world = new TileStore();
  generateWorld(world, seed);
  if (saved) world.applyOverridesJSON(saved.overrides);

  const light = new LightGrid();
  light.recompute(world);

  const inv = new Inventory(saved?.inventory ?? STARTING_INVENTORY);
  const renderer = new GameRenderer(canvas);

  // ---- player ----------------------------------------------------------
  const spawn = saved?.player ?? { ...spawnPoint(seed), sel: 0 };
  const player: PlayerState = {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    onGround: false,
    inWater: false,
    facing: 1,
    airJumps: 0,
  };
  let sel = spawn.sel ?? 0;

  hud.showGameHud();
  hud.setHotbarSel(sel);
  hud.updateInventory(inv);
  hud.setPlayers(choice.name, []);

  // ---- networking ------------------------------------------------------
  let sync: SyncEngine | null = null;
  let myId: string | null = null;
  const remotes = new Map<string, RemoteAvatar>();
  let roster: { name: string; action: string }[] = [];

  const onPlayers = (players: RemotePlayer[]) => {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const target = { x: p.x, y: p.y, dir: p.dir || 1 };
      const existing = remotes.get(p.id);
      if (existing) {
        existing.target = target;
        existing.name = p.name;
        existing.action = p.action || "idle";
      } else {
        remotes.set(p.id, { cur: { ...target }, target, name: p.name, action: p.action || "idle" });
      }
    }
    for (const id of [...remotes.keys()]) if (!seen.has(id)) remotes.delete(id);
    roster = players.map((p) => ({ name: p.name, action: p.action || "idle" }));
    hud.setPlayers(choice.name, roster);
  };

  if (client) {
    myId = await client.resolveIdentity();
    sync = new SyncEngine(client.exec, world, () => myId, {
      onPlayers,
      onToast: (msg) => hud.toast(msg),
    });
    client.subscribe((ev) => sync?.handleEvent(ev));
    try {
      await sync.join(choice.name);
      await sync.reconcile();
      hud.toast("Connected to shared world");
    } catch {
      hud.toast("Sync failed — edits will retry in the background");
    }
  }

  // ---- input -----------------------------------------------------------
  const keys = new Set<string>();
  let jumpPressed = false; // keydown edge, consumed by the next physics tick
  let digHeld = false;
  let placeHeld = false;
  let mouseX = 0;
  let mouseY = 0;

  window.addEventListener("keydown", (e) => {
    if (!e.repeat && (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp")) {
      jumpPressed = true;
    }
    keys.add(e.code);
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5)) - 1;
      if (n >= 0 && n < HOTBAR.length) {
        sel = n;
        hud.setHotbarSel(sel);
      }
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("wheel", (e) => {
    sel = (sel + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
    hud.setHotbarSel(sel);
  });
  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  window.addEventListener("mousedown", (e) => {
    if (e.button === 0) digHeld = true;
    if (e.button === 2) placeHeld = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) digHeld = false;
    if (e.button === 2) placeHeld = false;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  const editTile = (x: number, y: number, t: number): boolean => {
    if (!world.setTile(x, y, t)) return false;
    sync?.queueEdit(x, y, t);
    return true;
  };

  // ---- persistence ------------------------------------------------------
  const save = (): void => {
    saveWorld(worldId, {
      seed,
      name: choice.name,
      overrides: world.overridesToJSON(),
      inventory: inv.toJSON(),
      player: { x: player.x, y: player.y, sel, name: choice.name },
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
  let minimapAcc = MINIMAP_MS;
  let fps = 0;
  const dig: DigState = { x: -1, y: -1, progress: 0 };

  const frame = (now: number): void => {
    const dtMs = Math.min(100, now - last);
    const dt = dtMs / 1000;
    last = now;
    physicsAcc += dt;
    saveAcc += dtMs;
    minimapAcc += dtMs;
    fps = fps * 0.95 + (1000 / Math.max(1, dtMs)) * 0.05;

    // physics
    const move = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const jump = keys.has("Space") || keys.has("KeyW") || keys.has("ArrowUp");
    while (physicsAcc >= TICK) {
      stepPlayer(world, player, { move, jump, jumpPressed }, TICK);
      jumpPressed = false;
      physicsAcc -= TICK;
    }

    // dig / place at the mouse tile
    const cursorTile = renderer.screenToTile(mouseX, mouseY);
    const centerY = player.y - 0.95;
    const inReach = withinReach(player.x, centerY, cursorTile.x, cursorTile.y);
    let cursor: { x: number; y: number; progress: number } | null = null;
    if (inReach) {
      cursor = { ...cursorTile, progress: 0 };
      if (digHeld) {
        const before = world.getTile(cursorTile.x, cursorTile.y);
        const mined = digTick(world, inv, dig, cursorTile.x, cursorTile.y, dt);
        cursor.progress = dig.progress;
        if (mined !== null) {
          sync?.queueEdit(cursorTile.x, cursorTile.y, AIR);
          hud.updateInventory(inv);
          void before;
        }
      } else if (placeHeld) {
        const t = HOTBAR[sel];
        if (
          !tileIntersectsPlayer(player, cursorTile.x, cursorTile.y) &&
          place(world, inv, cursorTile.x, cursorTile.y, t)
        ) {
          sync?.queueEdit(cursorTile.x, cursorTile.y, t);
          hud.updateInventory(inv);
        }
      } else {
        dig.progress = 0;
      }
    } else {
      dig.progress = 0;
    }

    // lighting (full recompute when dirty — 80k cells, fast)
    if (world.lightDirty) light.recompute(world);

    // networking — action tells peers what we're doing (roster + map)
    const action = digHeld && inReach
      ? "mining"
      : placeHeld && inReach
        ? "building"
        : player.inWater
          ? "swimming"
          : move !== 0 || !player.onGround
            ? "walking"
            : "idle";
    const transform: Transform = {
      name: choice.name,
      x: player.x,
      y: player.y,
      dir: player.facing,
      sel,
      action,
    };
    sync?.tick(dtMs, transform, action !== "idle");

    // remote lerp
    const lerp = Math.min(1, dtMs / 250);
    const remoteDraws: RemoteDraw[] = [];
    for (const [id, r] of remotes) {
      r.cur.x += (r.target.x - r.cur.x) * lerp;
      r.cur.y += (r.target.y - r.cur.y) * lerp;
      r.cur.dir = r.target.dir;
      remoteDraws.push({
        id,
        name: r.name,
        x: r.cur.x,
        y: r.cur.y,
        dir: r.cur.dir,
        action: r.action,
      });
    }

    // render
    const elapsed = Date.now() / 1000 - createdAt;
    renderer.follow(player.x, player.y);
    renderer.render(
      world,
      light,
      dayFactor(elapsed),
      elapsed,
      { x: player.x, y: player.y, facing: player.facing, name: choice.name },
      remoteDraws,
      cursor,
    );
    if (minimapAcc >= MINIMAP_MS) {
      minimapAcc = 0;
      renderer.drawMinimap(hud.minimap, world, player, remoteDraws);
    }

    hud.setDebug(
      `fps ${fps.toFixed(0)}  pos ${player.x.toFixed(1)},${player.y.toFixed(1)}` +
        `  edits ${world.overrides.size}  peers ${remotes.size}\n` +
        `${online && client ? "online" : "offline"}${sync && sync.pending.size > 0 ? ` (${sync.pending.size} pending)` : ""}`,
    );

    if (saveAcc >= SAVE_MS) {
      saveAcc = 0;
      save();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // test/debug handle
  (window as unknown as Record<string, unknown>).__mt = {
    world,
    player,
    inv,
    sync,
    editTile,
    getOverrides: () => world.overridesToJSON(),
  };
}

void boot();
