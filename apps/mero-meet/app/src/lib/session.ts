// ── Session bootstrap ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + routing context in
// the URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   …#node_url=…&access_token=…&refresh_token=…
//     &app-id=…&context_id=…&executor_public_key=…&expires_at=…&dev_mode=…
//
// A Mero Meet "room" == one Calimero context. When the desktop deep-links into a
// specific room it passes `context_id` (+ our member identity
// `executor_public_key`). When it just opens the app (no room chosen), those are
// absent — then the user picks/creates a room in-app (RoomsPage), and we persist
// the choice per-app so a reload returns to the same room.
//
// `app-id` is the installed Mero Meet application id; we need it to create
// namespaces/contexts (rooms) for this app.

let contextId: string | null = null;
let executorPublicKey: string | null = null;
let applicationId: string | null = null;
let devMode = false;

function roomStorageKey(): string {
  return `mm-room:${applicationId ?? "default"}`;
}

export function captureSessionFromHash(): void {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const p = new URLSearchParams(hash);
    contextId = p.get("context_id") ?? p.get("contextId") ?? null;
    executorPublicKey =
      p.get("executor_public_key") ?? p.get("executorPublicKey") ?? null;
    applicationId =
      p.get("app-id") ?? p.get("application_id") ?? p.get("applicationId") ?? null;
    // The desktop app forwards its developer-mode setting here.
    devMode = p.get("dev_mode") === "1";
  }

  // No room handed in? Restore the last room the user opened for this app.
  if (!contextId) {
    try {
      const saved = localStorage.getItem(roomStorageKey());
      if (saved) {
        const { ctx, executor } = JSON.parse(saved);
        if (ctx && executor) {
          contextId = ctx;
          executorPublicKey = executor;
        }
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
  }
}

/** Developer mode as set in the Calimero desktop app's settings. */
export function isDeveloperMode(): boolean {
  return devMode;
}

export function getContextId(): string | null {
  return contextId;
}

export function getExecutorPublicKey(): string | null {
  return executorPublicKey;
}

/** The installed Mero Meet application id (needed to create rooms). */
export function getApplicationId(): string | null {
  return applicationId;
}

/**
 * Make `ctx` the active room with member identity `executor`, and persist it so
 * a reload (or the next open of this app) returns here. Used after the user
 * creates or joins a room in the lobby/rooms UI.
 */
export function setActiveRoom(ctx: string, executor: string): void {
  contextId = ctx;
  executorPublicKey = executor;
  try {
    localStorage.setItem(roomStorageKey(), JSON.stringify({ ctx, executor }));
  } catch {
    /* ignore blocked storage */
  }
}

/** Back-compat alias. */
export function setSession(ctx: string, executor: string): void {
  setActiveRoom(ctx, executor);
}

// ── Room name cache ───────────────────────────────────────────────────────────
// The room's human name lives in the contract (room.name) and in the namespace
// alias, but neither is guaranteed to be synced when we render the room list
// (especially right after joining via an invite). So we also cache the name
// locally whenever we learn it — on create, on join (from the invite), and from
// the lobby once entered — so the picker shows real names, never raw context ids.
function roomNameKey(ctx: string): string {
  return `mm-roomname:${applicationId ?? "default"}:${ctx}`;
}

export function setRoomName(ctx: string, name: string): void {
  if (!ctx || !name.trim()) return;
  try {
    localStorage.setItem(roomNameKey(ctx), name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

export function getRoomName(ctx: string): string {
  try {
    return localStorage.getItem(roomNameKey(ctx)) ?? "";
  } catch {
    return "";
  }
}

/** Unix seconds — the clock the contract expects (WASM has no wall clock). */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
