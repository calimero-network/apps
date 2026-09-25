// ── Session bootstrap ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + routing context in
// the URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   …#node_url=…&access_token=…&refresh_token=…
//     &app-id=…&context_id=…&executor_public_key=…&expires_at=…&dev_mode=…
//
// A Mero Updates "space" == one Calimero context. When the desktop deep-links
// into a specific space it passes `context_id` (+ our member identity
// `executor_public_key`). When it just opens the app (no space chosen), those
// are absent — then the user picks/creates a space in-app (CompaniesPage), and we
// persist the choice per-app so a reload returns to the same space.
//
// `app-id` is the installed Mero Updates application id; we need it to create
// namespaces/contexts (spaces) for this app.
//
// This mirrors mero-meet's session.ts exactly, only with a "mu-" storage-key
// prefix so the two apps never collide in localStorage.

let contextId: string | null = null;
let executorPublicKey: string | null = null;
let applicationId: string | null = null;
let activeNamespaceId: string | null = null;
let devMode = false;

// The desktop passes the session (app id, space context, identity, dev mode) in
// the URL hash only on the FIRST open — MeroProvider then strips the hash. So a
// plain refresh arrives with no hash and would lose all of it (blank app). We
// persist the whole bootstrap under one STABLE key (not app-scoped — the app id
// itself lives here) and restore it before any app-scoped storage key is computed.
const SESSION_KEY = "mu-session";

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

function spaceStorageKey(): string {
  return `mu-space:${applicationId ?? "default"}`;
}

export function captureSessionFromHash(): void {
  // Restore any persisted session first, so a refresh (no hash) keeps the app
  // id / space / identity the desktop only forwards on the first open. Hash
  // values (a fresh deep-link) still take precedence below.
  restoreSession();

  const hash = window.location.hash.slice(1);
  if (hash) {
    const p = new URLSearchParams(hash);
    contextId = p.get("context_id") ?? p.get("contextId") ?? contextId;
    executorPublicKey =
      p.get("executor_public_key") ??
      p.get("executorPublicKey") ??
      executorPublicKey;
    applicationId =
      p.get("app-id") ??
      p.get("application_id") ??
      p.get("applicationId") ??
      applicationId;
    // The desktop app forwards its developer-mode setting here.
    if (p.has("dev_mode")) devMode = p.get("dev_mode") === "1";
  }

  // No space handed in or persisted? Restore the last space opened for this app.
  if (!contextId) {
    try {
      const saved = localStorage.getItem(spaceStorageKey());
      if (saved) {
        const { ctx, executor, ns } = JSON.parse(saved);
        if (ctx && executor) {
          contextId = ctx;
          executorPublicKey = executor;
          // Absent for audiences stored before this was recorded — the audience then
          // simply offers no "back to audiences", rather than routing nowhere.
          if (ns) activeNamespaceId = ns;
        }
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
  }

  // Re-persist so the app id + restored/updated space survive the next refresh.
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

/**
 * The space (namespace) the active audience belongs to, when we know it.
 *
 * Null after a cold reload that restored an audience saved before this was stored,
 * so callers must treat "back to audiences" as an affordance that may be absent
 * rather than assuming a destination.
 */
export function getActiveNamespaceId(): string | null {
  return activeNamespaceId;
}

/** The installed Mero Updates application id (needed to create spaces). */
export function getApplicationId(): string | null {
  return applicationId;
}

/**
 * Make `ctx` the active space with member identity `executor`, and persist it so
 * a reload (or the next open of this app) returns here. Used after the user
 * creates or joins a space in the picker.
 */
export function setActiveAudience(
  ctx: string,
  executor: string,
  namespaceId?: string,
): void {
  contextId = ctx;
  executorPublicKey = executor;
  // Remembered so the audience can offer a way BACK to its audience list. A context
  // knows nothing about the namespace that holds it, and there is no "parent
  // of" read in the admin API, so the only cheap place to keep the link is
  // here — at the moment we entered the audience and already knew it.
  if (namespaceId) activeNamespaceId = namespaceId;
  try {
    localStorage.setItem(
      spaceStorageKey(),
      JSON.stringify({ ctx, executor, ns: activeNamespaceId }),
    );
  } catch {
    /* ignore blocked storage */
  }
  // Also fold into the stable session blob so a refresh restores this space
  // directly (the app-scoped key above needs applicationId, which only the
  // session blob preserves across a hash-less reload).
  persistSession();
}

/**
 * Forget the active space, in memory and in storage. Needed when the persisted
 * space's context no longer exists on the node (node reset, space deleted):
 * without this every boot restores the dead space and lands in a dead page
 * instead of the picker.
 */
export function clearActiveAudience(): void {
  contextId = null;
  executorPublicKey = null;
  activeNamespaceId = null;
  try {
    localStorage.removeItem(spaceStorageKey());
  } catch {
    /* ignore blocked storage */
  }
  persistSession();
}

// ── Stream name cache ─────────────────────────────────────────────────────────
// The space's human name lives in the contract (space_name) and in the
// namespace alias, but neither is guaranteed to be synced when we render the
// picker (especially right after joining). So we also cache the name locally
// whenever we learn it — so the picker shows real names, never raw context ids.
function audienceNameKey(ctx: string): string {
  return `mu-audiencename:${applicationId ?? "default"}:${ctx}`;
}

export function setAudienceName(ctx: string, name: string): void {
  if (!ctx || !name.trim()) return;
  try {
    localStorage.setItem(audienceNameKey(ctx), name.trim());
  } catch {
    /* ignore blocked storage */
  }
}

export function getAudienceName(ctx: string): string {
  try {
    return localStorage.getItem(audienceNameKey(ctx)) ?? "";
  } catch {
    return "";
  }
}

// ── Display name cache ──────────────────────────────────────────────────────
// The name the user joined with is stored in the contract (member), but on a
// hard refresh the round-trip hasn't happened yet. Cache it locally (per app) so
// a reload restores it instantly.
function usernameKey(): string {
  return `mu-username:${applicationId ?? "default"}`;
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
