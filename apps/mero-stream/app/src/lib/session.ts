// ── The active room, and what the app remembers between loads ────────────────
//
// v1 kept a desktop SSO bootstrap here: the context id, the executor key, the
// application id and a dev-mode flag, read from the URL hash tauri-app wrote
// and persisted across reloads. None of that exists on the component runtime:
// the session is the passkey session `SessionStore` keeps (src/session.ts),
// and a room is an app instance.
//
//   v1 namespace  ("stream")  -> an organization
//   v1 context    ("room")    -> an app instance created in that organization
//
// So the active room is an app id plus the org it lives in, remembered per
// target and per account (`bind`), so a dev session's room never reaches a
// cloud cluster and two accounts on one browser do not share a room.

let scope = "default";
let appId: string | null = null;
let orgId: string | null = null;

interface Stored {
  appId: string;
  org: string | null;
}

function roomKey(): string {
  return `ms-room:${scope}`;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* blocked storage: the app still works, it just forgets on reload */
  }
}

/**
 * Bind the stored room to a target and an account (`targetKey(target)` and the
 * signed-in account id), and restore the room last opened there.
 */
export function bind(target: string, account: string): void {
  scope = `${target}:${account}`;
  const stored = read<Stored>(roomKey());
  appId = stored?.appId ?? null;
  orgId = stored?.org ?? null;
}

/** The active room's app id (v1: its context id). */
export function getContextId(): string | null {
  return appId;
}

/**
 * The stream (organization) the active room belongs to, when we know it.
 * Callers treat "back to rooms" as an affordance that may be absent.
 */
export function getActiveNamespaceId(): string | null {
  return orgId;
}

/** Make `room` (an app id in `org`) the active room, and remember it. */
export function setActiveRoom(room: string, org?: string | null): void {
  appId = room;
  if (org) orgId = org;
  write(roomKey(), { appId, org: orgId });
}

/** Forget the active room: it no longer exists, or the person signed out. */
export function clearActiveRoom(): void {
  appId = null;
  orgId = null;
  write(roomKey(), null);
}

// ── Room names ───────────────────────────────────────────────────────────────
// A room's name is the app instance's name (`listApps`), but the call page
// opens straight from storage, so the name is cached when it is learned.

export function setRoomName(room: string, name: string): void {
  if (!room || !name.trim()) return;
  try {
    localStorage.setItem(`ms-roomname:${room}`, name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

export function getRoomName(room: string): string {
  try {
    return localStorage.getItem(`ms-roomname:${room}`) ?? "";
  } catch {
    return "";
  }
}

// ── Display name ─────────────────────────────────────────────────────────────
// The name the person joins a room with. The contract stores it (`join`); this
// copy makes a reload show it before the first round trip.

export function getUsername(): string {
  try {
    return localStorage.getItem(`ms-username:${scope}`) ?? "";
  } catch {
    return "";
  }
}

export function setUsername(name: string): void {
  if (!name.trim()) return;
  try {
    localStorage.setItem(`ms-username:${scope}`, name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

/** Unix seconds: `join`'s clock (the contract takes the caller's). */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Unix milliseconds: the clock `encodeFrame` and `postChunk` take, because
 * end-to-end media latency is meaningless at second resolution.
 */
export function nowMillis(): number {
  return Date.now();
}
