import { useCallback, useEffect, useMemo, useState } from "react";
import { browserPasskey, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  SessionStore,
  createClient,
  describeError,
  connectTarget,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import { PACKAGE } from "./pixart";

/** The app's name in stored keys. */
export const APP = "mero-pixart";

export type Session =
  | { status: "connecting" }
  | { status: "unconfigured"; message: string }
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

export const defaultDeps: SessionDeps = {
  env: import.meta.env,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

export interface SessionApi {
  session: Session;
  /** The sessions kept for this app on this target. */
  store: SessionStore | null;
  error: string | null;
  busy: boolean;
  signIn(): Promise<void>;
  signUp(name: string): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production), restores
 * a stored session, and signs in or up with a passkey.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  const [session, setSession] = useState<Session>({ status: "connecting" });
  const [store, setStore] = useState<SessionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      let target: Target;
      try {
        target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP, package: PACKAGE });
      } catch (e) {
        if (live) setSession({ status: "unconfigured", message: describeError(e) });
        return;
      }
      try {
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(APP, target, deps.storage);
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
  }, [deps]);

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
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [session, store],
  );

  const signIn = useCallback(() => ceremony((c) => c.signIn(deps.passkey())), [ceremony, deps]);
  const signUp = useCallback(
    (name: string) => ceremony((c) => c.signUp(deps.passkey(), name)),
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
    () => ({ session, store, error, busy, signIn, signUp, signOut }),
    [session, store, error, busy, signIn, signUp, signOut],
  );
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === "local"
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? "" : "s"})`
    : `Calimero Cloud ${target.cluster}`;
}
