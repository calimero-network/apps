// The connection and the signed-in account: merod local's nodes in
// development, the Calimero Cloud cluster in production, through mero-js 28's
// CalimeroClient (@calimero-apps/connect). Replaces v1's MeroProvider: there
// is no node URL to pick and no node login; the account is a passkey.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  browserPasskey,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  SessionStore,
  appSource,
  createClient,
  describeError,
  connectTarget,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from '@calimero-apps/connect';
import { PACKAGE_NAME } from '@/constants/config';

/** The app's name in stored keys. */
export const APP = 'mero-docs';

export type Session =
  | { status: 'connecting' }
  | { status: 'unconfigured'; message: string }
  | { status: 'signed-out'; client: CalimeroClient; target: Target }
  | { status: 'signed-in'; client: CalimeroClient; target: Target; accountId: string };

/** What the session is built from: the real ones in the app, fakes in tests. */
export interface SessionDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  /** The cluster's node list when this page is served by it (production). */
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: SessionDeps = {
  env: import.meta.env as unknown as ConnectEnv,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

export interface SessionApi {
  session: Session;
  error: string | null;
  busy: boolean;
  /** Where app instances are created from: the dev bundle, or the package. */
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Keeps the stored session current after a request (refresh tokens are single-use). */
  sync: () => void;
  signIn(): Promise<void>;
  signUp(name: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

function useSessionState(deps: SessionDeps): SessionApi {
  const [session, setSession] = useState<Session>({ status: 'connecting' });
  const [store, setStore] = useState<SessionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      let target: Target;
      try {
        target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP, package: PACKAGE_NAME });
      } catch (e) {
        if (live) setSession({ status: 'unconfigured', message: describeError(e) });
        return;
      }
      try {
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(APP, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        if (sessions.restore(client) && client.session) {
          setSession({ status: 'signed-in', client, target, accountId: client.session.accountId });
        } else {
          setSession({ status: 'signed-out', client, target });
        }
      } catch (e) {
        if (live) setSession({ status: 'unconfigured', message: describeError(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [deps]);

  const ceremony = useCallback(
    async (run: (client: CalimeroClient) => Promise<{ accountId: string }>) => {
      if (session.status !== 'signed-out') return;
      setBusy(true);
      setError(null);
      try {
        const { accountId } = await run(session.client);
        store?.sync(session.client);
        setSession({ status: 'signed-in', client: session.client, target: session.target, accountId });
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
    if (session.status !== 'signed-in') return;
    try {
      await session.client.signOut();
    } catch {
      // Already expired or unreachable: forgetting it here is what matters.
    }
    store?.clear();
    setSession({ status: 'signed-out', client: session.client, target: session.target });
  }, [session, store]);

  const client = session.status === 'signed-in' ? session.client : null;
  const sync = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);

  const source = useMemo(() => appSource(deps.env, PACKAGE_NAME), [deps.env]);

  return useMemo(
    () => ({ session, error, busy, source, passkey: deps.passkey, sync, signIn, signUp, signOut }),
    [session, error, busy, source, deps.passkey, sync, signIn, signUp, signOut],
  );
}

/** Connects once and shares the session with every screen. */
export function SessionProvider({
  deps = defaultDeps,
  children,
}: {
  deps?: SessionDeps;
  children: ReactNode;
}) {
  const api = useSessionState(deps);
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside <SessionProvider>');
  return value;
}

/** "merod local (3 nodes)" / "Calimero Cloud eu-shared-1". */
export function describeTarget(target: Target): string {
  return target.kind === 'local'
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? '' : 's'})`
    : `Calimero Cloud ${target.cluster}`;
}
