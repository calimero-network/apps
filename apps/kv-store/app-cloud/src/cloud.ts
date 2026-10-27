import {
  CalimeroClient,
  type CalimeroSession,
} from "@calimero-network/mero-js";

/**
 * The cluster this app talks to, from the build's environment.
 *
 * `VITE_CALIMERO_URL` is any node of the cluster. Mock attestation, which only
 * development clusters (`merod-v2 local`) produce, is trusted only by a build
 * made with `VITE_CALIMERO_ALLOW_MOCK=true` (`pnpm dev` and the e2e set it).
 * Unset means refuse: a mock quote proves nothing about who answers, and a
 * build that accepted one handed its sign-up to whoever stood at the URL.
 */
export const CLUSTER_URL: string = import.meta.env.VITE_CALIMERO_URL || "http://127.0.0.1:2501";

/** Whether this build trusts mock quotes. Only an explicit `true` does. */
export function allowMock(): boolean {
  return import.meta.env.VITE_CALIMERO_ALLOW_MOCK === "true";
}

export function newClient(): CalimeroClient {
  return new CalimeroClient({ baseUrl: CLUSTER_URL, policy: { allowMock: allowMock() } });
}

// The session token stays in memory: localStorage is readable by any script on
// the origin for as long as it is there. The tab keeps only the refresh token,
// in sessionStorage (gone with the tab), and a reload trades it for a session.
const SESSION_KEY = "kv-store-cloud.refresh";
const LEGACY_SESSION_KEY = "kv-store-cloud.session";
let current: CalimeroSession | null = null;

/** The session: in memory, or a refreshable stub this tab kept (expired, so it refreshes). */
export function savedSession(): CalimeroSession | null {
  if (current) return current;
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { accountId, refreshToken } = JSON.parse(raw) as { accountId: string; refreshToken: string };
    return accountId && refreshToken ? { accountId, refreshToken, sessionToken: "", expiresAt: 0 } : null;
  } catch {
    return null;
  }
}

export function saveSession(session: CalimeroSession | null): void {
  current = session;
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
    if (session) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accountId: session.accountId, refreshToken: session.refreshToken }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Storage blocked: the session lasts as long as this page.
  }
}

const STORE_KEY = "kv-store-cloud.app";

/** The store (app instance) this browser last opened. */
export function savedStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function saveStore(appId: string | null): void {
  try {
    if (appId) localStorage.setItem(STORE_KEY, appId);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
}
