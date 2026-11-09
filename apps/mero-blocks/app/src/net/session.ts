// Where the game connects and who is signed in: the local `merod local` nodes
// under `vite` (dev), a Calimero Cloud cluster by name in a production build,
// through `@calimero-apps/connect`. Sign-in is a passkey; the session is kept
// per app and per target, so a dev session never reaches a cloud cluster.
//
// Plain functions over a `Phase` value (the game is not a React app): the
// launcher renders whichever phase it holds and moves to the next.

import { browserPasskey, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  SessionStore,
  createClient,
  describeError,
  connectTarget,
  NotServedError,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import { PACKAGE } from "./blocks";

/** The app's name in stored keys. */
export const APP = "mero-blocks";

export type Phase =
  | { status: "unconfigured"; message: string }
  /** A copy of the game no cluster serves (its listing page): where to open it instead. */
  | { status: "listing"; message: string }
  | { status: "signed-out"; client: CalimeroClient; target: Target; sessions: SessionStore }
  | { status: "signed-in"; client: CalimeroClient; target: Target; sessions: SessionStore; accountId: string };

export type SignedIn = Extract<Phase, { status: "signed-in" }>;
export type SignedOut = Extract<Phase, { status: "signed-out" }>;

/** What a session is built from: the real ones in the app, fakes in tests. */
export interface SessionDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: SessionDeps = {
  env: import.meta.env,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

/**
 * Resolve the target, build the client and restore a stored session. A
 * production build no cluster serves and that names none (a static copy:
 * its listing page) is `listing`; one that cannot connect otherwise is
 * `unconfigured`.
 */
export async function connect(deps: SessionDeps = defaultDeps): Promise<Phase> {
  let target: Target;
  try {
    target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP, package: PACKAGE });
  } catch (e) {
    return { status: e instanceof NotServedError ? "listing" : "unconfigured", message: describeError(e) };
  }
  try {
    const client = await deps.makeClient(target);
    const sessions = new SessionStore(APP, target, deps.storage);
    if (sessions.restore(client) && client.session) {
      return { status: "signed-in", client, target, sessions, accountId: client.session.accountId };
    }
    return { status: "signed-out", client, target, sessions };
  } catch (e) {
    return { status: "unconfigured", message: describeError(e) };
  }
}

/** Sign in with an existing passkey. */
export async function signIn(phase: SignedOut, deps: SessionDeps = defaultDeps): Promise<SignedIn> {
  const { accountId } = await phase.client.signIn(deps.passkey());
  phase.sessions.sync(phase.client);
  return { ...phase, status: "signed-in", accountId };
}

/**
 * Create an account (a new passkey) named `name`. `invite` goes with it on a
 * cluster that requires one (`signUpInvite`). `passkey`: a `signUpFlow`'s, so
 * the second prompt waits for a click of its own (the launcher passes it).
 */
export async function signUp(
  phase: SignedOut,
  name: string,
  deps: SessionDeps = defaultDeps,
  invite: string | null = null,
  passkey: PasskeyProvider = deps.passkey(),
): Promise<SignedIn> {
  const { accountId } = invite
    ? await phase.client.signUp(passkey, name, { invite })
    : await phase.client.signUp(passkey, name);
  phase.sessions.sync(phase.client);
  return { ...phase, status: "signed-in", accountId };
}

/** End the session here (and on the node when it still answers). */
export async function signOut(phase: SignedIn): Promise<SignedOut> {
  try {
    await phase.client.signOut();
  } catch {
    // Already expired or unreachable: forgetting it here is what matters.
  }
  phase.sessions.clear();
  return { status: "signed-out", client: phase.client, target: phase.target, sessions: phase.sessions };
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}

const DEVICE = `${APP}:device`;

/**
 * This browser's device label: a random id kept in storage, sent with every
 * write so one account playing on two devices is two avatars (v1 got this from
 * the node's device key; the component runtime knows accounts only).
 */
export function deviceLabel(storage: KeyValueStorage | undefined = globalThis.localStorage): string {
  try {
    const stored = storage?.getItem(DEVICE);
    if (stored && /^[A-Za-z0-9_-]{1,64}$/.test(stored)) return stored;
  } catch {
    /* blocked storage: a fresh label for this page */
  }
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const label = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  try {
    storage?.setItem(DEVICE, label);
  } catch {
    /* not persisted: this page keeps it */
  }
  return label;
}
