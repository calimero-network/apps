/**
 * Mero Kombat, game only: the web app's engine (`app/src/game`, imported as
 * is) on one full-screen canvas, driven by the native shell.
 *
 * Nothing here talks to a node or a relay. The native app owns the session:
 * it pushes the contract's arena reads and the opponent's presence in, and
 * every contract call the engine makes goes out through `window.meroBridge`
 * to the native generated client. The fight pad is native too; its presses
 * arrive as `press` messages and feed the engine's own `Controls`, the same
 * path the web app's on-screen keycaps take.
 */
import { Game, type ArenaState, type NetHooks, type Slice } from "../../../app/src/game/controller";
import { fighterOf, type FighterId } from "../../../app/src/game/fighters";
import { Controls } from "../../../app/src/game/input";
import { setMuted } from "../../../app/src/game/audio";
import type { MoveKind } from "../../../app/src/game/sim";
import { isButton, type ArenaViewWire, type ToNative, type ToPage } from "./protocol";

declare global {
  interface Window {
    /** iOS: WKScriptMessageHandler named `meroBridge`. */
    webkit?: { messageHandlers?: { meroBridge?: { postMessage(body: string): void } } };
    /** Android: `addJavascriptInterface(…, "MeroBridgeAndroid")`. */
    MeroBridgeAndroid?: { postMessage(body: string): void };
    /** Contract calls through the native session. */
    meroBridge: {
      query(method: string, args?: unknown): Promise<unknown>;
      execute(method: string, args?: unknown): Promise<unknown>;
    };
    /** What the native side calls into. */
    meroGame: { receive(message: ToPage | string): void };
  }
}

const STEP_MS = 1000 / 60;

// ── to native ───────────────────────────────────────────────────────────────

function post(message: ToNative) {
  const body = JSON.stringify(message);
  if (window.webkit?.messageHandlers?.meroBridge) window.webkit.messageHandlers.meroBridge.postMessage(body);
  else if (window.MeroBridgeAndroid) window.MeroBridgeAndroid.postMessage(body);
}

let nextId = 1;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function call(op: "query" | "execute", method: string, args: unknown): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    post({ v: 1, op, id, method, args: args ?? {} });
  });
}

window.meroBridge = {
  query: (method, args) => call("query", method, args),
  execute: (method, args) => call("execute", method, args),
};

// ── the game ────────────────────────────────────────────────────────────────

const canvas = document.getElementById("arena") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const controls = new Controls();
controls.attach(); // a hardware keyboard, when one is paired
let game: Game | null = null;
let lastState: ArenaState | null = null;

/** The web app's `toArenaState`, over the wire form. */
function toArenaState(v: ArenaViewWire): ArenaState {
  return {
    status: v.status,
    match: v.match_index,
    round: v.round,
    results: v.round_results,
    winner: v.winner,
    flawless: v.flawless,
    names: [v.p1.name, v.p2.name],
    fighters: [v.p1.fighter, v.p2.fighter],
    online: [v.p1.online, v.p2.online],
    hp: [v.p1.hp, v.p2.hp],
    rounds: [v.p1.rounds_won, v.p2.rounds_won],
    hits: v.hits.map((h) => `${h.by}:${h.id}`),
  };
}

const net: NetHooks = {
  publish: (slice: Slice) => post({ v: 1, op: "presence", slice }),
  async act(a: { match: number; round: number; id: number; kind: MoveKind; hit: boolean; blocked: boolean }) {
    const started = performance.now();
    await window.meroBridge.execute("act", {
      match_index: a.match,
      round: a.round,
      id: a.id,
      kind: a.kind,
      hit: a.hit,
      blocked: a.blocked,
      now: Date.now(),
    });
    return Math.round(performance.now() - started);
  },
};

function boot(m: Extract<ToPage, { t: "boot" }>) {
  controls.clear();
  game = new Game(m.mode, m.local, [fighterOf(m.fighters[0]), fighterOf(m.fighters[1])], controls, m.mode === "net" ? net : null);
  if (lastState && m.mode !== "cpu") game.setState(lastState);
  if (typeof m.muted === "boolean") setMuted(m.muted);
  wasOver = false;
}

// ── the loop: the web app's ArenaCanvas loop, pausable ──────────────────────

let raf = 0;
let last = performance.now();
let acc = 0;
let wasOver = false;

function frame(now: number) {
  acc += Math.min(250, now - last);
  last = now;
  const g = game;
  if (g) {
    let steps = 0;
    while (acc >= STEP_MS && steps < 5) {
      g.step();
      acc -= STEP_MS;
      steps += 1;
    }
    if (steps === 5) acc = 0;
    g.draw(ctx);
    if (g.over !== wasOver) {
      wasOver = g.over;
      post({ v: 1, op: "over", over: g.over });
    }
  }
  raf = requestAnimationFrame(frame);
}

function start() {
  if (raf) return;
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  controls.clear();
}

// ── from native ─────────────────────────────────────────────────────────────

window.meroGame = {
  receive(raw) {
    const m: ToPage = typeof raw === "string" ? JSON.parse(raw) : raw;
    switch (m.t) {
      case "boot":
        boot(m);
        break;
      case "state":
        lastState = toArenaState(m.view);
        game?.setState(lastState);
        break;
      case "slice":
        game?.onSlice(m.slice);
        break;
      case "press":
        // Straight into the engine's input set, read on the next 60 Hz step.
        if (isButton(m.b)) controls.press(m.b, m.d);
        break;
      case "result": {
        const w = waiting.get(m.id);
        if (!w) break;
        waiting.delete(m.id);
        if (m.ok) w.resolve(m.value);
        else w.reject(new Error(m.error));
        break;
      }
      case "pause":
        stop();
        break;
      case "resume":
        start();
        break;
      case "restart":
        game?.restart();
        break;
      case "mute":
        setMuted(m.on);
        break;
    }
  },
};

document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
// No context menu, selection or double-tap zoom on a long press.
document.addEventListener("contextmenu", (e) => e.preventDefault());

start();
post({ v: 1, op: "ready" });

export type { FighterId };
