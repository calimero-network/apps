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
  type SignUpPolicy,
} from "@calimero-network/mero-js";
import {
  SessionStore,
  appSource,
  createClient,
  describeError,
  connectTarget,
  followInstanceRelease,
  NotServedError,
  readSignUpPolicy,
  signUpAccess,
  type AppSource,
  type SignUpAccess,
  type Target,
} from "@calimero-apps/connect";
import {
  describeCeremonyFailure,
  knownAccountHere,
  noAccountHereAfter,
  passkeyUnknownAfter,
  signInHere,
  signUpFlowHere,
  signUpHere,
  type CeremonyFailure,
  type ListingProps,
  type Session,
  type SignUpFlow,
  type SignUpStage,
} from "@calimero-apps/passkey";
import { watchUpgrades } from "@calimero-apps/passkey/upgrade";
import { dropInvite, pendingInvite } from "../utils/invitation";
import { markJoinedAwaitingName } from "../utils/enterWorkspace";
import { setMessengerDisplayName } from "../utils/messengerName";

/** The app's name in stored keys. */
export const APP = "mero-chat";
/** The registry package production instances are created from. */
export const APP_PACKAGE = "com.calimero.chat";

/** What the listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Chat",
  description: "Private team chat for your organization: channels, threads and direct messages.",
  package: APP_PACKAGE,
  dir: "mero-chat",
  dev: import.meta.env.DEV,
};

/** `listing`: a copy of the app no cluster serves (its listing page), which shows `<AppListing>`. */
export type Status = "connecting" | "unconfigured" | "listing" | "signed-out" | "signed-in";

interface State {
  status: Status;
  /** Why the build cannot connect (`unconfigured`, `listing`), or the last sign-in error. */
  message: string | null;
  accountId: string | null;
  /** False while an event stream is down (the reconnect resync keys on it). */
  isOnline: boolean;
  /**
   * The last failed sign-in or sign-up, described with the policy as it is
   * when shown (`describeCeremonyFailure`: a dismissed prompt says nothing).
   */
  failure: CeremonyFailure | null;
  /** This browser has signed in to an account on this cluster before. */
  knownAccount: boolean;
  /**
   * Where a sign-up is (`approve`: the browser refused the second prompt at
   * once, so it waits for its own click); `null` outside one.
   */
  signUpStage: SignUpStage | null;
  /** Why the sign-up's last approval failed; it waits at `approve` again. */
  confirmFailure: { error: unknown } | null;
  /** The cluster's sign-up policy: `undefined` until read, `null` when it cannot be. */
  policy: SignUpPolicy | null | undefined;
}

let state: State = {
  status: "connecting",
  message: null,
  accountId: null,
  isOnline: true,
  failure: null,
  knownAccount: false,
  policy: undefined,
  signUpStage: null,
  confirmFailure: null,
};
let client: CalimeroClient | null = null;
let sessions: SessionStore | null = null;
let target: Target | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  offerUpgrades();
  for (const l of listeners) l();
}

/** Takes the "new version" prompt away; set while a session is signed in. */
let stopUpgrades: { client: CalimeroClient; accountId: string; stop: () => void } | null = null;

/**
 * "A new version is available" (`@calimero-apps/passkey/upgrade`, which
 * the shared session hook mounts for the other apps): once per signed-in
 * session, to someone who may upgrade an instance (its owner, or
 * `MANAGE_APPLICATION` in its organization) only; gone at sign-out.
 */
function offerUpgrades(): void {
  const signedIn = state.status === "signed-in" && client && state.accountId ? { client, accountId: state.accountId } : null;
  if (stopUpgrades && (stopUpgrades.client !== signedIn?.client || stopUpgrades.accountId !== signedIn?.accountId)) {
    stopUpgrades.stop();
    stopUpgrades = null;
  }
  if (signedIn && !stopUpgrades) {
    stopUpgrades = {
      ...signedIn,
      stop: watchUpgrades({ client: signedIn.client, package: APP_PACKAGE, appName: "Mero Chat", accountId: signedIn.accountId }),
    };
  }
}

/**
 * A channel or DM is an app instance, and is served the frontend of the
 * release it runs: opening one that runs another release than this page
 * moves to `/app/{app}/` (the stored active chat reopens it there). Nothing
 * in development or while signed out, and never a loop.
 */
export function followChannelRelease(contextId: string): void {
  if (!client || state.status !== "signed-in" || !contextId) return;
  void followInstanceRelease({ client, app: contextId });
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

/** The target tests run against unless they name one. */
const TEST_TARGET: Target = { kind: "local", nodes: ["http://127.0.0.1:2428"] };

/** For tests: a client (or none), an account, a passkey stand-in, and the target. */
export function __setForTests(
  c: CalimeroClient | null,
  accountId: string | null = null,
  pk?: () => PasskeyProvider,
  t: Target = TEST_TARGET,
): void {
  client = c;
  sessions = null;
  target = c ? t : null;
  if (pk) passkeyProvider = pk;
  set({
    knownAccount: c ? knownAccountHere(t) : false,
    status: c && accountId ? "signed-in" : c ? "signed-out" : "connecting",
    accountId,
    message: null,
    failure: null,
    policy: undefined,
    signUpStage: null,
    confirmFailure: null,
  });
  if (c) loadSignUpPolicy(c);
}

/** Reads who may create an account here, once per client, without blocking anything. */
function loadSignUpPolicy(c: CalimeroClient): void {
  void readSignUpPolicy(c).then((policy) => {
    if (client === c) set({ policy });
  });
}

/** What the sign-up policy lets this page do, with the invite link's token if one is pending. */
function access(s: State = state): SignUpAccess {
  return signUpAccess(s.policy, pendingInvite() !== null);
}

let started: Promise<void> | null = null;

/** Connects once: the target from the build's environment, then a stored session if any. */
export function startCalimero(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      target = await connectTarget(import.meta.env, { app: APP, package: APP_PACKAGE });
      client = await createClient(target);
      sessions = new SessionStore(APP, target);
      loadSignUpPolicy(client);
      set({ knownAccount: knownAccountHere(target) });
      if (sessions.restore(client) && client.session) {
        set({ status: "signed-in", accountId: client.session.accountId, message: null });
      } else {
        set({ status: "signed-out", message: null });
      }
    } catch (e) {
      set({ status: e instanceof NotServedError ? "listing" : "unconfigured", message: describeError(e) });
    }
  })();
  return started;
}

const NOT_CONNECTED = "Not connected yet. Please retry in a moment.";

/** The client; throws before `startCalimero` has connected. */
export function getClient(): CalimeroClient {
  if (!client) throw new Error(NOT_CONNECTED);
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

/**
 * The sign-up in flight. Its second prompt is asked right after the first, and
 * waits for "Approve with your new passkey" only when that ask failed or was
 * refused (`signUpFlow`).
 */
let flow: SignUpFlow | null = null;

async function ceremony(
  during: CeremonyFailure["during"],
  run: (c: CalimeroClient, t: Target) => Promise<{ accountId: string }>,
  signUp?: SignUpFlow,
): Promise<void> {
  const c = getClient();
  if (!target) throw new Error(NOT_CONNECTED);
  set({ message: null, failure: null });
  try {
    const { accountId } = await run(c, target);
    sessions?.sync(c);
    set({ status: "signed-in", accountId, knownAccount: true });
  } catch (e) {
    // Kept as is: a dismissed prompt says nothing, but a sign-in that found
    // no account here still turns the panel to creating one.
    set({ failure: { error: e, during } });
    throw e;
  } finally {
    if (signUp) {
      if (flow === signUp) flow = null;
      set({ signUpStage: null, confirmFailure: null });
    }
  }
}

/** Sign in, offering only the passkeys that have worked on this cluster. */
export function signIn(): Promise<void> {
  return ceremony("sign-in", (c, t) => signInHere(c, t, passkey()));
}

/**
 * Create an account with a new passkey; the name is optional. The invite
 * link's token goes with it wherever the cluster lets an organization invite
 * admit, and the new account joins the workspace in that step: the token is
 * then dropped, with nothing left to redeem, and the workspace picker opens on
 * that workspace's name step ("Join <workspace>"), never on "Create
 * workspace", even before the node lists the new membership.
 */
export function signUp(name = ""): Promise<void> {
  flow?.cancel();
  if (!target) return Promise.reject(new Error(NOT_CONNECTED));
  const current: SignUpFlow = signUpFlowHere(passkey(), target, undefined, () =>
    set({ signUpStage: current.stage, confirmFailure: current.confirmFailure }),
  );
  flow = current;
  return ceremony(
    "sign-up",
    async (c, t) => {
      const made = await signUpHere(c, t, current.passkey, {
        name,
        invite: pendingInvite(),
        policy: state.policy,
        join: true,
      });
      if (made.joined) {
        // Before the session reads as signed in, so the picker's first load
        // already sees it.
        if (made.joined.org) {
          if (name.trim()) setMessengerDisplayName(name.trim());
          markJoinedAwaitingName(made.joined.org);
        }
        dropInvite();
      }
      return made;
    },
    current,
  );
}

/** The click that starts a sign-up's second prompt, which creates the account. */
export function approveSignUp(): void {
  flow?.approve();
}

/** Give up a sign-up at its Approve step (or on leaving the sign-in): quiet. */
export function cancelSignUp(): void {
  flow?.cancel();
}

export async function signOut(): Promise<void> {
  try {
    await client?.signOut();
  } catch {
    // Already expired or unreachable: forgetting it here is what matters.
  }
  sessions?.clear();
  setContextId("");
  set({ status: client ? "signed-out" : "connecting", accountId: null, failure: null });
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
  /** Why the build cannot connect, or why the last sign-in or sign-up failed. */
  message: string | null;
  /** What the cluster's sign-up policy lets this page do (`unknown` until read). */
  signUpAccess: SignUpAccess;
  /** The last sign-in failed because the cluster has no account for that passkey. */
  passkeyUnknown: boolean;
  /** The last sign-in found no account here: creating one is the way on. */
  noAccountHere: boolean;
  /** This browser has signed in to an account on this cluster before. */
  knownAccount: boolean;
  /** An invite link's token is waiting. */
  hasInvite: boolean;
  /** Where a sign-up is; at `approve` it waits for `approveSignUp()`. */
  signUpStage: SignUpStage | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOnline: boolean;
  accountId: string | null;
  /** The reconnect source, once signed in (v1: `mero.events`). */
  mero: { events: typeof connectEvents } | null;
  logout: () => void;
  /** The session as `@calimero-apps/passkey` sees it (`ManageInHomeLink`); null unless signed in. */
  session: Session | null;
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
    message: describeCeremonyFailure(s.failure, access(s), s.confirmFailure) ?? s.message,
    signUpAccess: access(s),
    passkeyUnknown: passkeyUnknownAfter(s.failure),
    noAccountHere: noAccountHereAfter(s.failure),
    knownAccount: s.knownAccount,
    hasInvite: pendingInvite() !== null,
    signUpStage: s.signUpStage,
    isAuthenticated: s.status === "signed-in",
    isLoading: s.status === "connecting",
    isOnline: s.isOnline,
    accountId: s.accountId,
    mero: s.status === "signed-in" ? meroHandle : null,
    logout: () => void signOut(),
    session:
      s.status === "signed-in" && client && target && s.accountId
        ? { status: "signed-in", client, target, accountId: s.accountId }
        : null,
  };
}
