import {
  CalimeroClient,
  type CalimeroSession,
} from "@calimero-network/mero-js";

/**
 * The cluster this app talks to, from the build's environment.
 *
 * `VITE_CALIMERO_URL` is any node of the cluster. `VITE_CALIMERO_ALLOW_MOCK`
 * trusts mock attestation, which only development clusters (`merod-v2 local`)
 * produce; a production build leaves it unset and must pass a real quote
 * verifier instead.
 */
export const CLUSTER_URL: string =
  import.meta.env["VITE_CALIMERO_URL"] ?? "http://127.0.0.1:2501";
const ALLOW_MOCK = (import.meta.env["VITE_CALIMERO_ALLOW_MOCK"] ?? "true") === "true";

export function newClient(): CalimeroClient {
  return new CalimeroClient({ baseUrl: CLUSTER_URL, policy: { allowMock: ALLOW_MOCK } });
}

const SESSION_KEY = "kv-store-cloud.session";

/** The signed-in session, kept across reloads (it refreshes itself). */
export function savedSession(): CalimeroSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CalimeroSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: CalimeroSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session lasts until the tab closes.
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
