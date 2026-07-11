// SSO session bootstrap: the desktop (tauri-app) opens the game with
//   #node_url=…&access_token=…&refresh_token=…&app-id=…&context_id=…
//   &executor_public_key=…&expires_at=…&dev_mode=1
// Capture everything BEFORE anything strips the hash, persist it, and prefer
// hash > stored > env for the application id (the mero-chat SSO-strip lesson).

const STORE_KEY = "mb-session";
const TOKENS_KEY = "mero-tokens";

export interface Session {
  nodeUrl: string | null;
  contextId: string | null;
  applicationId: string | null;
  executorPublicKey: string | null;
  devMode: boolean;
}

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

/** Parse the SSO hash. Returns true when a hash session was captured. */
export function captureSessionFromHash(): boolean {
  restore();
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return false;
  const p = new URLSearchParams(hash.slice(1));
  const nodeUrl = p.get("node_url");
  const accessToken = p.get("access_token");
  if (!nodeUrl || !accessToken) return false;

  session.nodeUrl = nodeUrl;
  session.contextId = p.get("context_id") ?? session.contextId;
  // tolerate both key spellings (tauri-app sends app-id)
  const appId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  if (appId) session.applicationId = appId;
  session.executorPublicKey = p.get("executor_public_key") ?? session.executorPublicKey;
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
  return true;
}

export function getSession(): Session {
  return session;
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

export function hasConnection(): boolean {
  return Boolean(session.nodeUrl && session.contextId && getAccessToken());
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
