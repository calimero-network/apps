// merraria entry point: session bootstrap, connect screen, game loop.

import { LightGrid } from "./engine/lighting";
import { digTick, DigState, Inventory, place, withinReach } from "./engine/mining";
import { PlayerState, stepPlayer, TICK, tileIntersectsPlayer } from "./engine/physics";
import { dayFactor } from "./engine/sim";
import { generateWorld, spawnPoint } from "./engine/terrain";
import { AIR, HOTBAR, STARTING_INVENTORY, tileDef } from "./engine/tiles";
import { TileStore } from "./engine/world";
import { AppError } from "@calimero-network/mero-js";
import { NotServedError, appSource, describeError, followInstanceRelease } from "@calimero-apps/connect";
import { renderListing } from "@calimero-apps/passkey/listing";
import "@calimero-apps/passkey/passkey.css";
import { GameClient, type WorldMeta } from "./net/client";
import { PACKAGE } from "./net/merraria";
import { connect, type Connection } from "./net/session";
import { CURRENT_WORLD, basename, invites, inviteToken, migrateStoredInvite, worldInviteLink, writeCurrentWorld } from "./net/worlds";
import { RemotePlayer, SyncEngine, Transform } from "./net/sync";
import { GameRenderer, RemoteDraw } from "./renderer";
import { loadWorld, playerInBounds, saveWorld } from "./state/persistence";
import { WheelSteps } from "./input/wheel";
import { Hud } from "./ui/hud";
import { Landing } from "./ui/landing";
import { knownName } from "./net/playerName";
import { showLandingOnce } from "./pages/landing/mount";
import { PauseMenu } from "./ui/overlays";
import {
  applyNativeChrome,
  frontTile,
  installBridge,
  isNativeHost,
  NativeGameClient,
  type NativeConfig,
} from "./native/host";

// ── Inbound invite links ──────────────────────────────────────────────────────
//
// Taken off the address bar before anything else runs: a person opening an
// invitation link (`?invite=<token>`, an org invite) is usually not signed in
// yet, and the token has to survive the passkey sign-up. Once signed in, the
// launcher asks before redeeming it. An invite an older build stored under its
// own keys moves over. (Not in the mobile apps' game-only mode: the app takes
// invitations itself.)
if (!isNativeHost()) {
  invites.capture(window.location, { basename: basename() });
  migrateStoredInvite(invites);
}

const SAVE_MS = 5000;
/** How often a world the node has not synced yet is asked again (see `SyncEngine.connect`). */
const CONNECT_RETRY_MS = 2000;
const WORLD_READY_MS = 60_000;

/**
 * Whether the world is not readable YET: founded right after the instance was
 * created, a world answers `NoWorld` until its `createWorld` lands. Through the
 * mobile bridge an error arrives as text, so the text is checked too (and for
 * v1's `Uninitialized`, which an app built before #702 still reports).
 */
function notReadyYet(err: unknown): boolean {
  if (err instanceof AppError) return err.appCode === "NoWorld";
  const text = err instanceof Error ? err.message : String(err);
  return /\bNoWorld\b|"type"\s*:\s*"(Uninitialized|GroupKeyPending)"/i.test(text);
}

async function fetchWorldMetaWhenReady(client: Pick<GameClient, "fetchWorldMeta">): Promise<WorldMeta> {
  const deadline = Date.now() + WORLD_READY_MS;
  for (;;) {
    try {
      return await client.fetchWorldMeta();
    } catch (err) {
      if (!notReadyYet(err) || Date.now() >= deadline) throw err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}
const MINIMAP_MS = 500; // live map: remote miners move on it in near real time

interface RemoteAvatar {
  cur: { x: number; y: number; dir: number };
  target: { x: number; y: number; dir: number };
  name: string;
  action: string;
}

async function boot(): Promise<void> {
  // The iOS/Android apps' game-only mode (see native/host.ts): the app signed
  // in and picked the world, so the session, landing and world picker below
  // are skipped and contract calls go through the app. Null on the web.
  const bridge = installBridge();
  const native = bridge ? await bridge.request<NativeConfig>("config") : null;

  const app = document.getElementById("app")!;
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "game-canvas";
  app.appendChild(canvas);
  const hud = new Hud(app);

  // The name a world asks for is its org's (net/playerName.ts); this one only
  // prefills the create-world dialog and the new-account name.
  const defaults = { name: knownName() || "Player", seed: 1337 };

  // The cluster: merod local under `vite`, the Calimero Cloud cluster the
  // build names in production. A production build without one is a hard stop
  // with the reason, not a silent fallback.
  let conn: Connection | null = null;
  if (!native) {
    try {
      conn = await connect();
    } catch (err) {
      if (err instanceof NotServedError) {
        // A copy no cluster serves (the listing page): the pitch, then where to open the game.
        await showLandingOnce();
        showListing(app);
      } else {
        showFatal(app, `Cannot connect to Calimero: ${describeError(err)}`);
      }
      return;
    }
  }

  let choice: { name: string };
  let worldId: string;
  let worldOrg: string | null = null;
  if (native) {
    choice = { name: native.name || defaults.name };
    worldId = native.contextId;
  } else {
    // The marketing landing page sits in front of the launcher. It skips
    // itself for an invitation link and after the first view in a session.
    // If it actually showed, the launcher drops its own logo/title/pitch and
    // opens on the world picker rather than a second landing page.
    const sawLanding = await showLandingOnce();
    const launched = await new Landing(app, conn!, appSource(import.meta.env, PACKAGE)).show(defaults, {
      chromeless: sawLanding,
    });
    choice = launched;
    worldId = launched.world.appId;
    worldOrg = launched.world.org;
  }

  // A world is an app instance, served the frontend of the release it runs:
  // another release's page moves there (`/app/{world}/`) before playing.
  if (conn && (await followInstanceRelease({ client: conn.client, app: worldId }))) return;

  // ---- world + net bootstrap -----------------------------------------
  // There is no offline mode, so an unreachable world is a hard stop.
  const client = native
    ? new NativeGameClient(bridge!, worldId)
    : new GameClient(conn!.client, worldId, conn!.accountId ?? "", conn!.sync);
  let seed: number;
  let createdAt = Math.floor(Date.now() / 1000);
  try {
    const meta = await fetchWorldMetaWhenReady(client);
    seed = meta.seed;
    createdAt = meta.createdAt || createdAt;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Forget the world before offering the way out. "Back to title" reloads,
    // and a reload with this contextId still stored walks straight back into
    // the same failure — the loop that made this unrecoverable without
    // clearing site data by hand.
    if (conn) writeCurrentWorld(localStorage, conn.scopedKey(CURRENT_WORLD), null);
    showFatal(app, `Could not reach the shared world (${reason}).`);
    bridge?.send({ type: "fatal", message: `Could not reach the shared world (${reason}).` });
    return;
  }

  const saved = loadWorld(worldId);

  const world = new TileStore();
  generateWorld(world, seed);
  if (saved) world.applyOverridesJSON(saved.overrides);

  const light = new LightGrid();
  light.recompute(world);

  const inv = new Inventory(saved?.inventory ?? STARTING_INVENTORY);
  const renderer = new GameRenderer(canvas);

  // ---- player ----------------------------------------------------------
  // Saves from before the map-edge walls can hold a player who fell out of
  // the world — restoring that position means falling forever. Rescue them.
  const savedPlayer = saved?.player ?? null;
  const keepSel = savedPlayer?.sel ?? 0;
  const rescued = savedPlayer !== null && !playerInBounds(savedPlayer);
  const spawn = playerInBounds(savedPlayer)
    ? savedPlayer
    : { ...spawnPoint(seed), sel: keepSel };
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
  if (native) applyNativeChrome();
  hud.setHotbarSel(sel);
  hud.updateInventory(inv);
  hud.setPlayers(choice.name, []);
  // must come after showGameHud — the toast container exists only then
  if (rescued) hud.toast("You were outside the world — respawned at the surface");

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

  myId = await client.resolveIdentity();
  // In the apps the identity is learnt from `join`, which may land after this.
  const nativeClient = client instanceof NativeGameClient ? client : null;
  sync = new SyncEngine(client.world, world, () => myId ?? nativeClient?.identity ?? null, {
    onPlayers,
    onToast: (msg) => hud.toast(msg),
  });
  void client.subscribe(
    (ev) => sync?.handleEvent(ev),
    // Back from a dropped stream: pull the world and roster again, push
    // anything still pending — the same reconcile as joining.
    () => { void sync?.reconcile().catch(() => {}); },
  );
  // Joined and read, retrying while the world cannot answer yet (a world whose
  // `createWorld` has not landed answers `NoWorld`; a dropped connection fails
  // the same way). Not awaited: the game runs meanwhile, and its edits queue
  // until the join goes through.
  void sync.connect(choice.name, CONNECT_RETRY_MS).then((connected) => {
    if (!connected) return;
    hud.toast("Connected to shared world");
    bridge?.send({ type: "status", state: "connected" });
  });

  // ---- input -----------------------------------------------------------
  const keys = new Set<string>();
  let jumpPressed = false; // keydown edge, consumed by the next physics tick
  let digHeld = false;
  let placeHeld = false;
  let mouseX = 0;
  let mouseY = 0;

  // ---- pause menu (Esc/O — Minecraft-style game menu with options) -------
  const menu = new PauseMenu(app, {
    onLeave: () => {
      save();
      void sync?.leave();
      window.location.reload(); // back to the landing/launcher
    },
    // An invitation into the world's org, approved with this player's passkey.
    onInvite:
      conn && worldOrg
        ? ((c: Connection, org: string) => async () =>
            worldInviteLink(await inviteToken(c.client, org, c.approver()), org, { world: worldId, from: choice.name }))(
            conn,
            worldOrg,
          )
        : undefined,
    onZoomChange: (zoom) => renderer.setZoom(zoom),
  });
  renderer.setZoom(native?.zoom ?? menu.getZoom()); // restore the player's zoom choice

  const toggleMenu = (): void => {
    keys.clear(); // an open menu swallows gameplay input
    jumpPressed = false;
    digHeld = false;
    placeHeld = false;
    menu.toggle();
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" || e.code === "KeyO") return toggleMenu();
    if (menu.open) return; // menu swallows gameplay keys
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
  // A trackpad's two-finger scroll is a stream of tiny deltas plus a momentum
  // tail, not one notch — bound directly to the hotbar it cycled every slot
  // several times per flick. WheelSteps turns the stream into notches (a mouse
  // wheel's ~100px notch still steps immediately).
  const wheelSteps = new WheelSteps();
  window.addEventListener("wheel", (e) => {
    if (menu.open) return;
    const steps = wheelSteps.push(e.deltaY, e.deltaMode);
    if (steps === 0) return;
    sel = (((sel + steps) % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
    hud.setHotbarSel(sel);
  });
  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  window.addEventListener("mousedown", (e) => {
    if (menu.open) return;
    if (e.button === 0) digHeld = true;
    if (e.button === 2) placeHeld = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) digHeld = false;
    if (e.button === 2) placeHeld = false;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  // The apps' on-screen controls (native/host.ts). A tapped tile is the target
  // until the player walks out of reach of it; until then the buttons act on
  // the tile in front of the player.
  let touchMove = 0;
  let touchJump = false;
  let tapped: { x: number; y: number } | null = null;
  if (bridge) {
    bridge.handlers = {
      ...bridge.handlers,
      input: (i) => {
        touchMove = i.move;
        touchJump = i.jump;
        if (i.jumpPressed) jumpPressed = true;
        digHeld = i.mine;
        placeHeld = i.place && !i.mine;
      },
      target: (x, y) => {
        tapped = renderer.screenToTile(x, y);
      },
      select: (slot) => {
        if (slot < 0 || slot >= HOTBAR.length) return;
        sel = slot;
        hud.setHotbarSel(sel);
      },
      zoom: (value) => renderer.setZoom(Math.min(1.6, Math.max(0.6, value))),
      pause: () => {
        touchMove = 0;
        touchJump = false;
        jumpPressed = false;
        digHeld = false;
        placeHeld = false;
        save();
      },
      leave: async () => {
        save();
        await sync?.leave();
      },
    };
  }
  let hudSent = "";
  const sendHud = (): void => {
    if (!bridge) return;
    const slots = HOTBAR.map((id) => ({
      id,
      name: tileDef(id).name,
      color: `#${tileDef(id).color.toString(16).padStart(6, "0")}`,
      count: inv.count(id),
    }));
    const key = `${sel}|${slots.map((s) => s.count).join(",")}`;
    if (key === hudSent) return;
    hudSent = key;
    bridge.send({ type: "hud", sel, slots });
  };

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
    const move = Math.sign(
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
        (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) +
        touchMove,
    );
    const jump = keys.has("Space") || keys.has("KeyW") || keys.has("ArrowUp") || touchJump;
    while (physicsAcc >= TICK) {
      stepPlayer(world, player, { move, jump, jumpPressed }, TICK);
      jumpPressed = false;
      physicsAcc -= TICK;
    }

    // dig / place at the mouse tile
    const centerY = player.y - 0.95;
    if (tapped && !withinReach(player.x, centerY, tapped.x, tapped.y)) tapped = null;
    const cursorTile = bridge
      ? tapped ?? frontTile(player, (x, y) => world.getTile(x, y))
      : renderer.screenToTile(mouseX, mouseY);
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
        `online${sync && sync.pending.size > 0 ? ` (${sync.pending.size} pending)` : ""}`,
    );

    sendHud();

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
    input: () => ({ digHeld, placeHeld, uiOpen: menu.open }),
  };
}

/** Online-only dead end: the world is unreachable — say why, offer the title screen. */
/**
 * The listing page (`renderListing` from `@calimero-apps/passkey`): "Open
 * Merraria" at the copy Calimero Cloud serves, and deploying it there.
 */
function showListing(app: HTMLElement): void {
  const el = document.createElement("div");
  el.dataset.testid = "listing";
  el.style.cssText =
    "position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
    "background:#0b0e14;font-family:system-ui,-apple-system,sans-serif;padding:24px;" +
    "--passkey-ink:#ffffff;--passkey-muted:#cfd9e4;--passkey-primary-bg:#4f8cff;" +
    "--passkey-primary-ink:#ffffff;--passkey-secondary-ink:#cfd9e4;--passkey-radius:9px;";
  const card = document.createElement("div");
  card.style.cssText = "width:100%;max-width:420px;";
  renderListing(card, {
    name: "Merraria",
    description: "Terraria-style multiplayer mining sandbox, with no game server.",
    package: PACKAGE,
    dir: "merraria",
    dev: import.meta.env.DEV,
  });
  el.append(card);
  app.appendChild(el);
}

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
    "padding:12px 28px;border-radius:9px;border:none;font-size:15px;" +
    "font-weight:600;cursor:pointer;color:#fff;background:#4f8cff;";
  btn.addEventListener("click", () => window.location.reload());
  el.append(msg, btn);
  app.appendChild(el);
}

void boot();
