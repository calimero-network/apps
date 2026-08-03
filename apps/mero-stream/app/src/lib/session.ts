// ── Session bootstrap ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + routing context in
// the URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   …#node_url=…&access_token=…&refresh_token=…
//     &app-id=…&context_id=…&executor_public_key=…&expires_at=…&dev_mode=…
//
// A Mero Stream "stream" == one Calimero context. When the desktop deep-links
// into a specific stream it passes `context_id` (+ our member identity
// `executor_public_key`). When it just opens the app (no stream chosen), those
// are absent — then the user picks/creates a stream in-app (StreamsPage), and we
// persist the choice per-app so a reload returns to the same stream.
//
// `app-id` is the installed Mero Stream application id; we need it to create
// namespaces/contexts (streams) for this app.
//
// This mirrors mero-meet's session.ts exactly, only with an "ms-" storage-key
// prefix so the two apps never collide in localStorage.

let contextId: string | null = null;
let executorPublicKey: string | null = null;
let applicationId: string | null = null;
let devMode = false;

// The desktop passes the session (app id, stream context, identity, dev mode) in
// the URL hash only on the FIRST open — MeroProvider then strips the hash. So a
// plain refresh arrives with no hash and would lose all of it (blank app). We
// persist the whole bootstrap under one STABLE key (not app-scoped — the app id
// itself lives here) and restore it before any app-scoped storage key is computed.
const SESSION_KEY = "ms-session";

function persistSession(): void {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ applicationId, contextId, executorPublicKey, devMode }),
    );
  } catch {
    /* ignore blocked storage */
  }
}

function restoreSession(): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    applicationId = s.applicationId ?? applicationId;
    contextId = s.contextId ?? contextId;
    executorPublicKey = s.executorPublicKey ?? executorPublicKey;
    if (typeof s.devMode === "boolean") devMode = s.devMode;
  } catch {
    /* ignore malformed/blocked storage */
  }
}

function streamStorageKey(): string {
  return `ms-stream:${applicationId ?? "default"}`;
}

export function captureSessionFromHash(): void {
  // Restore any persisted session first, so a refresh (no hash) keeps the app
  // id / stream / identity the desktop only forwards on the first open. Hash
  // values (a fresh deep-link) still take precedence below.
  restoreSession();

  const hash = window.location.hash.slice(1);
  if (hash) {
    const p = new URLSearchParams(hash);
    contextId = p.get("context_id") ?? p.get("contextId") ?? contextId;
    executorPublicKey =
      p.get("executor_public_key") ?? p.get("executorPublicKey") ?? executorPublicKey;
    applicationId =
      p.get("app-id") ?? p.get("application_id") ?? p.get("applicationId") ?? applicationId;
    // The desktop app forwards its developer-mode setting here.
    if (p.has("dev_mode")) devMode = p.get("dev_mode") === "1";
  }

  // No stream handed in or persisted? Restore the last stream opened for this app.
  if (!contextId) {
    try {
      const saved = localStorage.getItem(streamStorageKey());
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

  // Re-persist so the app id + restored/updated stream survive the next refresh.
  persistSession();
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

/** The installed Mero Stream application id (needed to create streams). */
export function getApplicationId(): string | null {
  return applicationId;
}

/**
 * Make `ctx` the active stream with member identity `executor`, and persist it so
 * a reload (or the next open of this app) returns here. Used after the user
 * creates or joins a stream in the picker.
 */
export function setActiveRoom(ctx: string, executor: string): void {
  contextId = ctx;
  executorPublicKey = executor;
  try {
    localStorage.setItem(streamStorageKey(), JSON.stringify({ ctx, executor }));
  } catch {
    /* ignore blocked storage */
  }
  // Also fold into the stable session blob so a refresh restores this stream
  // directly (the app-scoped key above needs applicationId, which only the
  // session blob preserves across a hash-less reload).
  persistSession();
}

/**
 * Forget the active stream, in memory and in storage. Needed when the persisted
 * stream's context no longer exists on the node (node reset, stream deleted):
 * without this every boot restores the dead stream and lands in a dead page
 * instead of the picker.
 */
export function clearActiveRoom(): void {
  contextId = null;
  executorPublicKey = null;
  try {
    localStorage.removeItem(streamStorageKey());
  } catch {
    /* ignore blocked storage */
  }
  persistSession();
}

// ── Stream name cache ─────────────────────────────────────────────────────────
// The stream's human name lives in the contract (stream_name) and in the
// namespace alias, but neither is guaranteed to be synced when we render the
// picker (especially right after joining). So we also cache the name locally
// whenever we learn it — so the picker shows real names, never raw context ids.
function streamNameKey(ctx: string): string {
  return `ms-streamname:${applicationId ?? "default"}:${ctx}`;
}

export function setRoomName(ctx: string, name: string): void {
  if (!ctx || !name.trim()) return;
  try {
    localStorage.setItem(streamNameKey(ctx), name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

export function getRoomName(ctx: string): string {
  try {
    return localStorage.getItem(streamNameKey(ctx)) ?? "";
  } catch {
    return "";
  }
}

// ── Display name cache ──────────────────────────────────────────────────────
// The name the user joined with is stored in the contract (member), but on a
// hard refresh the round-trip hasn't happened yet. Cache it locally (per app) so
// a reload restores it instantly.
function usernameKey(): string {
  return `ms-username:${applicationId ?? "default"}`;
}

export function getUsername(): string {
  try {
    return localStorage.getItem(usernameKey()) ?? "";
  } catch {
    return "";
  }
}

export function setUsername(name: string): void {
  if (!name.trim()) return;
  try {
    localStorage.setItem(usernameKey(), name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

/** Unix seconds — the clock the contract expects (WASM has no wall clock). */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Unix milliseconds — the clock `encode_frame` expects, and ONLY that method.
 *
 * Fragments carry millis while members carry seconds, because §4's headline
 * metric is end-to-end fragment latency (capture → peer render). That is
 * expected to land in the hundreds-of-ms-to-seconds band, which quantizes to
 * "0 or 1" at second resolution. See `Fragment::created_at` in logic/src/lib.rs.
 */
export function nowMillis(): number {
  return Date.now();
}
