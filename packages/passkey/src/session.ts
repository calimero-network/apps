import { useCallback, useEffect, useMemo, useState } from "react";
import { browserPasskey, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  SessionStore,
  createClient,
  NotServedError,
  connectTarget,
  describeError,
  describeSignInError,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";

export type Session =
  | { status: "connecting" }
  | { status: "unconfigured"; message: string }
  /**
   * A copy of the app no cluster serves (its listing page, e.g. a static host
   * built without `VITE_CALIMERO_CLUSTER`): the app shows `<AppListing>`,
   * which opens the copy Calimero Cloud serves. `package` is the one the app
   * passed; `message` says why there is nothing to connect to.
   */
  | { status: "listing"; console: string; message: string; package?: string }
  | { status: "signed-out"; client: CalimeroClient; target: Target }
  | { status: "signed-in"; client: CalimeroClient; target: Target; accountId: string };

/** What the hook is built from: the real ones in the app, fakes in tests. */
export interface SessionDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

/**
 * The real deps for a build's environment. Call it once at module level
 * (`passkeyDeps(import.meta.env)`): the hook reconnects when its deps change.
 */
export function passkeyDeps(env: ConnectEnv): SessionDeps {
  return { env, makeClient: (target) => createClient(target), passkey: browserPasskey };
}

export interface SessionApi {
  session: Session;
  /** The sessions kept for this app on this target. */
  store: SessionStore | null;
  error: string | null;
  busy: boolean;
  /** The environment the target was resolved from: where instances come from (`appSource`). */
  env: ConnectEnv;
  /** The passkey every ceremony and step-up uses. */
  passkey: () => PasskeyProvider;
  /** Sign in with a passkey the person already has (any Calimero app's). */
  signIn(): Promise<void>;
  /** Create an account with a new passkey. The name is optional. */
  signUp(name?: string): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * A dismissed or timed-out passkey prompt. The person chose not to go on, so
 * it is a quiet cancel, not an error to show.
 */
export function isPasskeyCancel(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const name = (e as { name?: unknown }).name;
    if (name === "NotAllowedError" || name === "AbortError" || name === "ConfirmCancelled") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** What the app says about itself, beside its name. */
export interface PasskeySessionOptions {
  /**
   * The app's package id: where a production build that names no cluster, on
   * a page no cluster serves, asks the directory where the app runs
   * (`connectTarget`).
   */
  package?: string;
}

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production: named by
 * the build, else the one serving the page, else the package's primary cluster
 * in the directory), restores a stored session for `app`, and signs in or up
 * with a passkey.
 */
export function usePasskeySession(app: string, deps: SessionDeps, options: PasskeySessionOptions = {}): SessionApi {
  const { package: pkg } = options;
  const [session, setSession] = useState<Session>({ status: "connecting" });
  const [store, setStore] = useState<SessionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      let target: Target;
      try {
        target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app, package: pkg });
      } catch (e) {
        if (!live) return;
        setSession(
          e instanceof NotServedError
            ? { status: "listing", console: e.console, message: describeError(e), ...(pkg ? { package: pkg } : {}) }
            : { status: "unconfigured", message: describeError(e) },
        );
        return;
      }
      try {
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(app, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        if (sessions.restore(client) && client.session) {
          setSession({ status: "signed-in", client, target, accountId: client.session.accountId });
        } else {
          setSession({ status: "signed-out", client, target });
        }
      } catch (e) {
        if (live) setSession({ status: "unconfigured", message: describeError(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [app, deps, pkg]);

  const ceremony = useCallback(
    async (run: (client: CalimeroClient) => Promise<{ accountId: string }>) => {
      if (session.status !== "signed-out") return;
      setBusy(true);
      setError(null);
      try {
        const { accountId } = await run(session.client);
        store?.sync(session.client);
        setSession({ status: "signed-in", client: session.client, target: session.target, accountId });
      } catch (e) {
        if (!isPasskeyCancel(e)) setError(describeSignInError(e));
      } finally {
        setBusy(false);
      }
    },
    [session, store],
  );

  const signIn = useCallback(() => ceremony((c) => c.signIn(deps.passkey())), [ceremony, deps]);
  const signUp = useCallback(
    (name?: string) => ceremony((c) => c.signUp(deps.passkey(), name?.trim() ?? "")),
    [ceremony, deps],
  );

  const signOut = useCallback(async () => {
    if (session.status !== "signed-in") return;
    try {
      await session.client.signOut();
    } catch {
      // Already expired or unreachable: forgetting it here is what matters.
    }
    store?.clear();
    setSession({ status: "signed-out", client: session.client, target: session.target });
  }, [session, store]);

  return useMemo(
    () => ({ session, store, error, busy, env: deps.env, passkey: deps.passkey, signIn, signUp, signOut }),
    [session, store, error, busy, deps, signIn, signUp, signOut],
  );
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}
