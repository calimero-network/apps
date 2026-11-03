// Native host: the game-only mode the iOS and Android apps run (apps/merraria/mobile).
//
// Off on the web. It turns on only when the page is opened with `?host=native`
// AND the app has given it a message channel (WKWebView's
// `webkit.messageHandlers.meroBridge`, Android's `MeroBridgeAndroid`), so a
// browser that is handed the query string still gets the normal app.
//
// In this mode the app has already signed in and picked the world. The page is
// only the engine: no landing, no session, no node. Every contract call goes to
// the app as `window.meroBridge.query/execute`, which answers it through the
// account's relay with the generated client; the app's on-screen controls come
// back as input messages. The protocol (both directions, JSON):
//
//   page -> app  {type:"request", id, op:"query"|"execute", method, args}
//                {type:"request", id, op:"config"}            -> {contextId, name, zoom?}
//                {type:"hud", sel, slots:[{id, name, color, count}]}
//                {type:"status", state:"connected"}
//                {type:"fatal", message}
//                {type:"left"}                                after a "leave"
//   app -> page  {type:"response", id, ok, value? | error?}
//                {type:"event", kind}                         a relay event (a nudge)
//                {type:"input", move, jump, jumpPressed, mine, place}
//                {type:"target", x, y}                        a tap, in CSS px
//                {type:"select", slot}
//                {type:"zoom", value}
//                {type:"pause"}                               backgrounded / menu open
//                {type:"leave"}                               save and leave the world

//
// The bridge speaks the v1 method names (`get_overrides`, `set_tiles`, …):
// `V1_METHOD` maps the engine's component names onto them, so a game bundle
// built before or after the component port runs in the same apps. The apps
// translate on their side (`BridgeDispatcher` in the iOS/Android `GameBridge`)
// onto the component ABI, and answer `get_overrides` with every override as one
// array, which `exec` hands back as a single last page.

import type { GameEvent } from "../net/events";
import type { Exec, MethodName } from "../net/merraria";

/** The bridge's (v1) name for each of the engine's methods: what the apps' bridge dispatchers answer. */
export const V1_METHOD: Readonly<Record<Exclude<MethodName, "createWorld">, string>> = {
  setTiles: "set_tiles",
  getOverrides: "get_overrides",
  getPlayers: "get_players",
  worldMeta: "world_meta",
  join: "join",
  heartbeat: "heartbeat",
  leave: "leave",
};

/** The contract's views (by their v1 names): everything else is a write. */
export const VIEW_METHODS: ReadonlySet<string> = new Set(["get_overrides", "get_players", "world_meta"]);

export interface NativeConfig {
  contextId: string;
  name: string;
  zoom?: number;
}

export interface NativeInput {
  /** -1 left, 0, 1 right */
  move: number;
  jump: boolean;
  /** the jump button went down since the last input message */
  jumpPressed: boolean;
  mine: boolean;
  place: boolean;
}

export interface NativeHandlers {
  input: (input: NativeInput) => void;
  target: (x: number, y: number) => void;
  select: (slot: number) => void;
  zoom: (value: number) => void;
  pause: () => void;
  leave: () => Promise<void>;
  event: (kind: string) => void;
}

type Post = (json: string) => void;

interface NativeWindow {
  webkit?: { messageHandlers?: { meroBridge?: { postMessage(message: string): void } } };
  MeroBridgeAndroid?: { postMessage(message: string): void };
  meroBridge?: MeroBridge;
}

/** The app's message channel, or null in a browser. */
export function nativeChannel(w: NativeWindow = window as unknown as NativeWindow): Post | null {
  const ios = w.webkit?.messageHandlers?.meroBridge;
  if (ios) return (m) => ios.postMessage(m);
  const android = w.MeroBridgeAndroid;
  if (android) return (m) => android.postMessage(m);
  return null;
}

export function isNativeHost(): boolean {
  return new URLSearchParams(window.location.search).get("host") === "native" && nativeChannel() !== null;
}

/** Contract calls and app messages over the native channel. */
export class MeroBridge {
  handlers: Partial<NativeHandlers> = {};
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly post: Post) {}

  query<T = unknown>(method: string, args: Record<string, unknown>): Promise<T> {
    return this.request<T>("query", { method, args });
  }

  execute<T = unknown>(method: string, args: Record<string, unknown>): Promise<T> {
    return this.request<T>("execute", { method, args });
  }

  request<T = unknown>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.post(JSON.stringify({ type: "request", id, op, ...extra }));
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  send(message: Record<string, unknown>): void {
    try {
      this.post(JSON.stringify(message));
    } catch {
      /* the app is gone (being torn down); nothing to tell */
    }
  }

  /** What the app calls (`window.meroBridge.receive(…)`), with an object or its JSON. */
  receive(message: unknown): void {
    let m: Record<string, unknown>;
    try {
      m = (typeof message === "string" ? JSON.parse(message) : message) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    const h = this.handlers;
    switch (m.type) {
      case "response": {
        const p = this.pending.get(Number(m.id));
        if (!p) return;
        this.pending.delete(Number(m.id));
        if (m.ok) p.resolve(m.value ?? null);
        else p.reject(new Error(typeof m.error === "string" ? m.error : "the app refused the call"));
        return;
      }
      case "input":
        h.input?.({
          move: Math.sign(Number(m.move) || 0),
          jump: m.jump === true,
          jumpPressed: m.jumpPressed === true,
          mine: m.mine === true,
          place: m.place === true,
        });
        return;
      case "target":
        if (Number.isFinite(m.x) && Number.isFinite(m.y)) h.target?.(Number(m.x), Number(m.y));
        return;
      case "select":
        if (Number.isInteger(m.slot)) h.select?.(Number(m.slot));
        return;
      case "zoom":
        if (Number.isFinite(m.value)) h.zoom?.(Number(m.value));
        return;
      case "pause":
        h.pause?.();
        return;
      case "leave":
        void (h.leave?.() ?? Promise.resolve()).finally(() => this.send({ type: "left" }));
        return;
      case "event":
        h.event?.(typeof m.kind === "string" ? m.kind : "");
        return;
      default:
        return;
    }
  }
}

/** Install `window.meroBridge` when running in the app; null on the web. */
export function installBridge(): MeroBridge | null {
  if (!isNativeHost()) return null;
  const bridge = new MeroBridge(nativeChannel()!);
  (window as unknown as NativeWindow).meroBridge = bridge;
  return bridge;
}

/**
 * GameClient's twin over the bridge. Errors keep `rpc <method>: <reason>`, the
 * shape boot() waits on for a world that has not synced yet.
 *
 * The identity is the id `join` returns: the contract's own name for this
 * device, which is what `get_players` and `TilesChanged` carry.
 */
export class NativeGameClient {
  identity: string | null = null;

  constructor(
    private readonly bridge: MeroBridge,
    readonly contextId: string,
  ) {}

  exec: Exec = async <T = unknown>(method: MethodName, args: Record<string, unknown>): Promise<T> => {
    if (method === "createWorld") throw new Error("rpc createWorld: the app creates worlds itself");
    const v1 = V1_METHOD[method];
    // v1's `get_overrides` takes no arguments and answers every override as
    // one array: sent bare, and handed back as the component's single last page.
    const sent = method === "getOverrides" ? {} : args;
    let out: unknown;
    try {
      out = VIEW_METHODS.has(v1) ? await this.bridge.query(v1, sent) : await this.bridge.execute(v1, sent);
    } catch (err) {
      throw new Error(`rpc ${v1}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (method === "getOverrides") return { items: Array.isArray(out) ? out : [], next: null } as T;
    if (method === "join" && out && typeof (out as { id?: unknown }).id === "string") {
      this.identity = (out as { id: string }).id;
    }
    return out as T;
  };

  async resolveIdentity(): Promise<string | null> {
    return this.identity;
  }

  async fetchWorldMeta(): Promise<{ name: string; seed: number; createdAt: number }> {
    return this.exec("worldMeta", {});
  }

  /** Relay events are nudges with no payload: each one re-reads the tiles. */
  async subscribe(onEvent: (ev: GameEvent) => void, onReconnect?: () => void): Promise<void> {
    this.bridge.handlers.event = (kind) => {
      if (kind === "reconnected") onReconnect?.();
      else onEvent({ kind: "TilesChanged", value: null });
    };
  }
}

/**
 * The tile a mine/place button acts on when the player has not tapped one:
 * straight ahead at the feet if something is there, else at the head, else
 * the empty spot at the feet (somewhere to build).
 */
export function frontTile(
  player: { x: number; y: number; facing: number },
  getTile: (x: number, y: number) => number,
): { x: number; y: number } {
  const x = Math.floor(player.x + player.facing * 0.9);
  const feet = Math.floor(player.y - 0.5);
  const head = Math.floor(player.y - 1.5);
  if (getTile(x, feet) !== 0) return { x, y: feet };
  if (getTile(x, head) !== 0) return { x, y: head };
  return { x, y: feet };
}

/** The HUD the app draws natively is hidden here; what stays moves clear of the controls. */
export function applyNativeChrome(): void {
  const viewport = document.querySelector<HTMLMetaElement>("meta[name=viewport]");
  if (viewport && !viewport.content.includes("viewport-fit")) viewport.content += ", viewport-fit=cover";
  const style = document.createElement("style");
  style.textContent = `
#mt-hotbar, #mt-hint, #mt-debug { display: none !important; }
#mt-players { top: calc(10px + env(safe-area-inset-top)); right: calc(12px + env(safe-area-inset-right));
  font-size: 11px; min-width: 0; }
#mt-minimap { bottom: auto; right: auto; top: calc(10px + env(safe-area-inset-top));
  left: calc(68px + env(safe-area-inset-left)); width: 140px; }
#mt-toasts { bottom: auto; top: calc(60px + env(safe-area-inset-top)); }
html, body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
`;
  document.head.appendChild(style);
}
