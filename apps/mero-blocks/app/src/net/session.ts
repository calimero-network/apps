// Session bootstrap for BOTH auth paths:
//  - Desktop SSO: tauri-app opens the game with a full hash
//      #node_url=…&access_token=…&refresh_token=…&app-id=…&context_id=…
//      &executor_public_key=…&expires_at=…&dev_mode=1
//    → capture everything and auto-enter the world (zero clicks).
//  - Web login: we redirected to {node}/auth/login and came back with
//      #access_token=…&refresh_token=…&application_id=…&context_id=…
//      &context_identity=…[&node_url=…]
//    (mero-js parseAuthCallback format; node_url may be absent — we stashed
//    it before redirecting, see auth.ts takePendingNodeUrl).
// App-id resolution prefers hash > stored > env (the mero-chat SSO-strip lesson).

import { takePendingNodeUrl } from "./auth";

const STORE_KEY = "mb-session";
const TOKENS_KEY = "mero-tokens";

export interface Session {
  nodeUrl: string | null;
  contextId: string | null;
  applicationId: string | null;
  executorPublicKey: string | null;
  devMode: boolean;
  /** governance coordinates of the current world (set on create/invite-join;
   *  resolved lazily otherwise) — needed to mint invites */
  namespaceId?: string | null;
  groupId?: string | null;
}

export type CaptureResult =
  | "none" // no usable hash; session possibly restored from storage
  | "partial" // credentials captured but no context yet (web callback)
  | "full"; // credentials + context — straight into the game

let session: Session = {
  nodeUrl: null,
  contextId: null,
  applicationId: null,
  executorPublicKey: null,
  devMode: false,
};

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(session));
  } catch {
    /* storage full/unavailable — session just won't survive refresh */
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) session = { ...session, ...JSON.parse(raw) };
  } catch {
    /* corrupt stored session — start clean */
  }
}

/** Parse the SSO / auth-callback hash. Always restores stored state first. */
export function captureSessionFromHash(): CaptureResult {
  restore();
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return "none";
  const p = new URLSearchParams(hash.slice(1));
  const accessToken = p.get("access_token");
  if (!accessToken) return "none";

  // node url: hash > the one stashed before the web-login redirect > stored
  const nodeUrl = p.get("node_url") ?? takePendingNodeUrl() ?? session.nodeUrl;
  if (!nodeUrl) return "none";
  session.nodeUrl = nodeUrl;

  session.contextId = p.get("context_id") || session.contextId;
  // tolerate both spellings (tauri sends app-id, auth callback application_id)
  const appId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  if (appId) session.applicationId = appId;
  // desktop names it executor_public_key, the auth callback context_identity
  session.executorPublicKey =
    p.get("executor_public_key") ?? p.get("context_identity") ?? session.executorPublicKey;
  session.devMode = p.get("dev_mode") === "1";
  persist();

  localStorage.setItem(
    TOKENS_KEY,
    JSON.stringify({
      access_token: accessToken,
      refresh_token: p.get("refresh_token") ?? "",
      expires_at: p.get("expires_at") ?? "",
    }),
  );

  // we own the page (no MeroProvider) — safe to strip
  window.history.replaceState({}, "", window.location.pathname + window.location.search);
  return session.contextId ? "full" : "partial";
}

export function getSession(): Session {
  return session;
}

/** merge fields chosen after login (world picker, resolved app id) */
export function updateSession(patch: Partial<Session>): void {
  session = { ...session, ...patch };
  persist();
}

export function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    return JSON.parse(raw).access_token ?? null;
  } catch {
    return null;
  }
}

/** logged into a node (may still need to pick a world) */
export function isAuthenticated(): boolean {
  return Boolean(session.nodeUrl && getAccessToken());
}

/** ready to play online right now */
export function hasConnection(): boolean {
  return Boolean(session.nodeUrl && session.contextId && getAccessToken());
}

export function clearSession(): void {
  session = {
    nodeUrl: null,
    contextId: null,
    applicationId: null,
    executorPublicKey: null,
    devMode: false,
  };
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** for tests */
export function resetSession(): void {
  session = {
    nodeUrl: null,
    contextId: null,
    applicationId: null,
    executorPublicKey: null,
    devMode: false,
  };
}
