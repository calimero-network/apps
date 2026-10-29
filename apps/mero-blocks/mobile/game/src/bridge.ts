// The page half of the native bridge: the game's contract calls go to the app, which runs them
// through its signed-in session (the generated BlocksClient over `contract.bound(to:)`), and the
// answers come back here. Nothing in the page talks to a node or a relay.
//
// Wire format (JSON text both ways; the Swift and Kotlin `BridgeCodec` are the other half, and
// their tests pin the same shapes):
//
//   page → app   {"id":7,"op":"query","method":"get_players","args":{"now":1730000000}}
//                {"id":8,"op":"execute","method":"set_blocks","args":{"edits":[…],"now":…}}
//                {"op":"ready"} | {"op":"loaded"} | {"op":"menu"} | {"op":"haptic","style":"light"}
//                {"op":"fatal","message":"…"}
//   app → page   {"type":"result","id":7,"ok":true,"result":[…]}
//                {"type":"result","id":8,"ok":false,"error":"…"}
//                {"type":"start","contextId":"…","myId":"…","name":"…","worldName":"…","sensitivity":1}
//                {"type":"event","kind":"…"} | {"type":"pause"} | {"type":"resume"}
//                {"type":"insets","top":0,"left":44,"bottom":21,"right":44}
//
// The app delivers a message by evaluating `window.meroBridge.receive("<the JSON, as a string>")`.

export type CallOp = "query" | "execute";

export interface StartConfig {
  contextId: string;
  myId: string;
  name: string;
  worldName: string;
  sensitivity: number;
}

export interface Insets {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type AppMessage =
  | ({ type: "start" } & StartConfig & Partial<{ insets: Insets }>)
  | { type: "event"; kind: string }
  | { type: "pause" }
  | { type: "resume" }
  | ({ type: "insets" } & Insets)
  | { type: "settings"; sensitivity: number };

/** How the page posts to the app: a WKScriptMessageHandler on iOS, a JavascriptInterface on Android. */
export interface BridgeHost {
  post(json: string): void;
}

interface NativeWindow {
  webkit?: { messageHandlers?: { meroBlocks?: { postMessage(body: string): void } } };
  MeroBlocksAndroid?: { postMessage(body: string): void };
}

export function detectHost(w: unknown = window): BridgeHost | null {
  const nw = w as NativeWindow;
  const ios = nw.webkit?.messageHandlers?.meroBlocks;
  if (ios) return { post: (json) => ios.postMessage(json) };
  const android = nw.MeroBlocksAndroid;
  if (android) return { post: (json) => android.postMessage(json) };
  return null;
}

/** Views go through `query`; everything else is a mutation and goes through `execute`. */
export const VIEW_METHODS = new Set(["world_meta", "get_overrides", "get_players", "override_count"]);

/** A call the app never answers (the app went away mid-call) fails after this long. */
export const CALL_TIMEOUT_MS = 30_000;

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class MeroBridge {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private host: BridgeHost | null,
    private onMessage: (msg: AppMessage) => void,
  ) {}

  query<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.call<T>("query", method, args);
  }

  execute<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.call<T>("execute", method, args);
  }

  /** The game's `exec`: the right path for the method. */
  exec = <T = unknown>(method: string, args: Record<string, unknown>): Promise<T> =>
    VIEW_METHODS.has(method) ? this.query<T>(method, args) : this.execute<T>(method, args);

  /** A one-way message to the app (`ready`, `loaded`, `menu`, `haptic`, `fatal`). */
  send(op: string, fields: Record<string, unknown> = {}): void {
    this.host?.post(JSON.stringify({ ...fields, op }));
  }

  /** Called by the app with one message, as JSON text. */
  receive(json: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "result") {
      const id = Number(msg.id);
      const call = this.pending.get(id);
      if (!call) return;
      this.pending.delete(id);
      clearTimeout(call.timer);
      if (msg.ok === true) call.resolve(msg.result ?? null);
      else call.reject(new Error(typeof msg.error === "string" ? msg.error : "the call failed"));
      return;
    }
    if (typeof msg.type === "string") this.onMessage(msg as unknown as AppMessage);
  }

  /** Calls still waiting for an answer. */
  get inFlight(): number {
    return this.pending.size;
  }

  private call<T>(op: CallOp, method: string, args: Record<string, unknown>): Promise<T> {
    const host = this.host;
    if (!host) return Promise.reject(new Error("Mero Blocks runs inside the app"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from the app`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      host.post(JSON.stringify({ id, op, method, args }));
    });
  }
}
