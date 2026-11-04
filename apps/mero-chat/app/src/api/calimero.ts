/**
 * The one connection to Calimero: a mero-js `CalimeroClient` on the target the
 * build names (`merod local` in `vite`, a Calimero Cloud cluster in a
 * production build), the stored passkey session, and the conversation the
 * screens have open.
 *
 * It replaces v1's `MeroProvider` and the per-context globals mero-react kept
 * (`getContextId`, `getContextIdentity`, ...). The data layer reads the client
 * through `getClient()`; React reads the session through `useCalimero()`.
 *
 * | v1 | here |
 * |---|---|
 * | a node URL + node login / Cloud wallet | a passkey sign-in or sign-up on the build's one target |
 * | `getContextId()`: the context on screen | the same name: the **app instance** on screen |
 * | `getContextIdentity()`: this node's identity in that context | the signed-in **account**: one id everywhere |
 */
import { useSyncExternalStore } from "react";
import {
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import {
  SessionStore,
  appSource,
  createClient,
  describeError,
  connectTarget,
  type AppSource,
  type Target,
} from "@calimero-apps/connect";

/** The app's name in stored keys. */
export const APP = "mero-chat";
/** The registry package production instances are created from. */
export const APP_PACKAGE = "com.calimero.chat";

export type Status = "connecting" | "unconfigured" | "signed-out" | "signed-in";

interface State {
  status: Status;
  /** Why the build cannot connect (`unconfigured`), or the last sign-in error. */
  message: string | null;
  accountId: string | null;
  /** False while an event stream is down (the reconnect resync keys on it). */
  isOnline: boolean;
}

let state: State = { status: "connecting", message: null, accountId: null, isOnline: true };
let client: CalimeroClient | null = null;
let sessions: SessionStore | null = null;
let target: Target | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where instances come from: the dev bundle, or the package in production. */
export function chatSource(): AppSource {
  return appSource(import.meta.env, APP_PACKAGE);
}

/** The passkey prompt; replaced in tests. */
let passkeyProvider: () => PasskeyProvider = browserPasskey;
export function passkey(): PasskeyProvider {
  return passkeyProvider();
}

/** For tests: a client (or none), an account, and a passkey stand-in. */
export function __setForTests(
  c: CalimeroClient | null,
  accountId: string | null = null,
  pk?: () => PasskeyProvider,
): void {
  client = c;
  sessions = null;
  if (pk) passkeyProvider = pk;
  set({ status: c && accountId ? "signed-in" : c ? "signed-out" : "connecting", accountId, message: null });
}

let started: Promise<void> | null = null;

/** Connects once: the target from the build's environment, then a stored session if any. */
export function startCalimero(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      target = await connectTarget(import.meta.env, { app: APP });
      client = await createClient(target);
      sessions = new SessionStore(APP, target);
      if (sessions.restore(client) && client.session) {
        set({ status: "signed-in", accountId: client.session.accountId, message: null });
      } else {
        set({ status: "signed-out", message: null });
      }
    } catch (e) {
      set({ status: "unconfigured", message: describeError(e) });
    }
  })();
  return started;
}

/** The client; throws before `startCalimero` has connected. */
export function getClient(): CalimeroClient {
  if (!client) throw new Error("Not connected yet. Please retry in a moment.");
  return client;
}

/** Keeps the stored session current after a request (refresh tokens are single-use). */
export function after(): void {
  if (client) sessions?.sync(client);
}

/** The signed-in account, or "" when there is none. */
export function getAccountId(): string {
  return state.accountId ?? "";
}

async function ceremony(run: (c: CalimeroClient) => Promise<{ accountId: string }>): Promise<void> {
  const c = getClient();
  set({ message: null });
  try {
    const { accountId } = await run(c);
    sessions?.sync(c);
    set({ status: "signed-in", accountId });
  } catch (e) {
    set({ message: describeError(e) });
    throw e;
  }
}

export function signIn(): Promise<void> {
  return ceremony((c) => c.signIn(passkey()));
}

export function signUp(name: string): Promise<void> {
  return ceremony((c) => c.signUp(passkey(), name));
}

export async function signOut(): Promise<void> {
  try {
    await client?.signOut();
  } catch {
    // Already expired or unreachable: forgetting it here is what matters.
  }
  sessions?.clear();
  setContextId("");
  set({ status: client ? "signed-out" : "connecting", accountId: null });
}

/** Set by the event streams: false while one is down. */
export function setOnline(isOnline: boolean): void {
  if (state.isOnline !== isOnline) set({ isOnline });
}

// ── reconnects ────────────────────────────────────────────────────────────────

type ConnectHandler = (sessionId: string) => void;
const connectHandlers = new Set<ConnectHandler>();

/** What `useReconnectResync` listens to: a stream that came back. */
export const connectEvents = {
  on(_event: "connect", handler: ConnectHandler): void {
    connectHandlers.add(handler);
  },
  off(_event: "connect", handler: ConnectHandler): void {
    connectHandlers.delete(handler);
  },
  emit(sessionId: string): void {
    for (const h of connectHandlers) h(sessionId);
  },
};

// ── the conversation on screen ───────────────────────────────────────────────

const CONTEXT_KEY = `${APP}:context-id`;
let contextId: string | null = null;

/** The app instance (v1: context) the screens have open. */
export function getContextId(): string | null {
  if (contextId === null) {
    try {
      contextId = localStorage.getItem(CONTEXT_KEY) ?? "";
    } catch {
      contextId = "";
    }
  }
  return contextId || null;
}

export function setContextId(id: string): void {
  contextId = id;
  try {
    if (id) localStorage.setItem(CONTEXT_KEY, id);
    else localStorage.removeItem(CONTEXT_KEY);
  } catch {
    /* blocked storage: this page only */
  }
}

/**
 * The caller's identity in the open conversation. In v1 every context had its
 * own member key; on Calimero 1.0 the account is the caller everywhere.
 */
export function getContextIdentity(): string | null {
  return state.accountId || null;
}

/** Kept for the screens that set it with the context: there is one identity. */
export function setContextIdentity(_identity: string): void {
  /* the account is the identity */
}

// ── React ────────────────────────────────────────────────────────────────────

export interface CalimeroState {
  status: Status;
  message: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOnline: boolean;
  accountId: string | null;
  /** The reconnect source, once signed in (v1: `mero.events`). */
  mero: { events: typeof connectEvents } | null;
  logout: () => void;
}

const meroHandle = { events: connectEvents };

function snapshot(): State {
  return state;
}

/** The session, for screens. Replaces mero-react's `useMero()`. */
export function useCalimero(): CalimeroState {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    status: s.status,
    message: s.message,
    isAuthenticated: s.status === "signed-in",
    isLoading: s.status === "connecting",
    isOnline: s.isOnline,
    accountId: s.accountId,
    mero: s.status === "signed-in" ? meroHandle : null,
    logout: () => void signOut(),
  };
}
