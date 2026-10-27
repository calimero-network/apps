// The game session: which cluster, which world, and the player's place in it.
// The player signs in with a passkey (auth.ts); `@calimero-apps/cloud` keeps
// the session itself (in memory, its refresh token in this tab), and this
// record remembers only the game-level coordinates. The app id stored here is
// a PREFERENCE: admin.ts resolves it through the cluster.

import { CloudMero, readSession, writeSession } from "@calimero-apps/cloud";

const STORE_KEY = "mb-session";

/**
 * How this player is connected. Always `node` on Calimero Cloud: signed in to
 * the cluster. (`account` was v1's relay-enrolled device and is never set.)
 */
export type SessionKind = "node" | "account";

export interface Session {
  /** absent on records written before accounts existed — those are `node` */
  kind?: SessionKind;
  nodeUrl: string | null;
  contextId: string | null;
  applicationId: string | null;
  executorPublicKey: string | null;
  devMode: boolean;
  /** governance coordinates of the current world (set on create/invite-join;
   *  resolved lazily otherwise) — needed to mint invites */
  namespaceId?: string | null;
  groupId?: string | null;
  /** human name of the current world — travels inside invites as the
   *  namespace alias (the curb groupAlias/groupName pattern) */
  worldName?: string | null;
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

/**
 * Restore the stored game session. Calimero Cloud has no login hash (v1's
 * node web login and desktop SSO): the player signs in with a passkey in the
 * page (auth.ts) and the cloud client keeps the session.
 */
export function captureSessionFromHash(): CaptureResult {
  restore();
  if (!isAuthenticated()) return "none";
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

/** The session token, or null when signed out (never in localStorage). */
export function getAccessToken(): string | null {
  return readSession()?.sessionToken || null;
}

export function sessionKind(): SessionKind {
  return "node";
}

/** Bumped on every sign-out, so a transport built for the previous player is not reused. */
let epoch = 0;
export function sessionEpoch(): number {
  return epoch;
}

/** Signed in to the cluster (the world may still need picking). */
export function isAuthenticated(): boolean {
  return Boolean(session.nodeUrl && readSession());
}

/** Ready to play online right now. */
export function hasConnection(): boolean {
  return isAuthenticated() && Boolean(session.contextId);
}

export function clearSession(): void {
  epoch += 1;
  session = {
    nodeUrl: null,
    contextId: null,
    applicationId: null,
    executorPublicKey: null,
    devMode: false,
  };
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing to clear */
  }
  writeSession(null);
}

/**
 * Forget which world we were in, WITHOUT logging out.
 *
 * A stored `contextId` outlives the node that issued it — a node reset, a
 * reinstall, or opening the same account on a second device all leave a
 * context this node holds no identity for. Booting straight into it is how the
 * game ends up showing
 *
 *   Could not reach the shared world (rpc world_meta: No owned identity found
 *   for this context)
 *
 * with no way out but clearing site data. Dropping these four fields returns
 * the player to the world picker with their login intact.
 */
export function clearWorld(): void {
  session = {
    ...session,
    contextId: null,
    executorPublicKey: null,
    namespaceId: null,
    groupId: null,
    worldName: null,
  };
  persist();
}

/** for tests */
export function resetSession(): void {
  epoch += 1;
  session = {
    nodeUrl: null,
    contextId: null,
    applicationId: null,
    executorPublicKey: null,
    devMode: false,
  };
}

/**
 * Make sure the session is live: a tab restored from its refresh token trades
 * it for a session here, before anything goes online. A failure signs out.
 */
export async function ensureFreshSession(): Promise<void> {
  if (!session.nodeUrl || !readSession()) return;
  const mero = new CloudMero(session.nodeUrl);
  try {
    if (!(await mero.validate())) writeSession(null);
  } finally {
    mero.close();
  }
}
