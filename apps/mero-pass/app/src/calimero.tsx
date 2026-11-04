// The connection to Calimero, for every screen: the local `merod local` nodes
// under `vite` (dev), a Calimero Cloud cluster by name (or an attested node by
// URL, `VITE_CALIMERO_TARGET=node`) in a production build,
// through `@calimero-apps/connect` and mero-js's `CalimeroClient`. It replaces
// mero-react's `MeroProvider`: sign-in is a passkey (sign in, or a new account
// with a new passkey), a session is stored per app and per target, and there is
// no node URL to type, no auth frontend and no desktop hand-off.

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

import { PACKAGE } from './lib/meroPass';

/** The app's name in stored keys. */
export const APP = 'mero-pass';

export type Status = 'connecting' | 'unconfigured' | 'signed-out' | 'signed-in';

export interface Calimero {
  status: Status;
  /** Set once connected (signed in or out). */
  client: CalimeroClient | null;
  target: Target | null;
  /** The signed-in account. */
  accountId: string | null;
  /** Where vaults are created from: the dev bundle, or the package. */
  source: AppSource;
  /** Why the app cannot connect (`unconfigured`). */
  message: string | null;
  /** The last sign-in failure. */
  error: string | null;
  busy: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** "merod local (3 nodes)" / "Calimero Cloud <cluster>" / "node <host>". */
  where: string;
  signIn(): Promise<void>;
  signUp(name: string): Promise<void>;
  signOut(): Promise<void>;
  /** A passkey for a step-up (`412 CONFIRM_REQUIRED`): invites, member changes. */
  passkey(): PasskeyProvider;
  /** Keeps the stored session current; run after requests. */
  after(): void;
}

/** What the provider is built from: the real ones in the app, fakes in tests. */
export interface CalimeroDeps {
  env: ConnectEnv;
  makeClient: (target: Target) => Promise<CalimeroClient>;
  passkey: () => PasskeyProvider;
  storage?: KeyValueStorage;
  servedNodes?: () => Promise<string[] | null>;
}

export const defaultDeps: CalimeroDeps = {
  env: import.meta.env,
  makeClient: (target) => createClient(target),
  passkey: browserPasskey,
};

export function describeTarget(target: Target | null): string {
  if (!target) return '';
  return target.kind === 'local'
    ? `merod local (${target.nodes.length} node${target.nodes.length === 1 ? '' : 's'})`
    : target.direct
      ? `node ${target.cluster}`
      : `Calimero Cloud ${target.cluster}`;
}

type State =
  | { status: 'connecting' }
  | { status: 'unconfigured'; message: string }
  | { status: 'signed-out'; client: CalimeroClient; target: Target }
  | {
      status: 'signed-in';
      client: CalimeroClient;
      target: Target;
      accountId: string;
    };

const Ctx = createContext<Calimero | null>(null);

export function CalimeroProvider({
  children,
  deps = defaultDeps,
}: {
  children: ReactNode;
  deps?: CalimeroDeps;
}) {
  const [state, setState] = useState<State>({ status: 'connecting' });
  const [store, setStore] = useState<SessionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const target = await connectTarget(deps.env, { servedNodes: deps.servedNodes, app: APP });
        const client = await deps.makeClient(target);
        const sessions = new SessionStore(APP, target, deps.storage);
        if (!live) return;
        setStore(sessions);
        if (sessions.restore(client) && client.session) {
          setState({
            status: 'signed-in',
            client,
            target,
            accountId: client.session.accountId,
          });
        } else {
          setState({ status: 'signed-out', client, target });
        }
      } catch (e) {
        if (live)
          setState({ status: 'unconfigured', message: describeError(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [deps]);

  const ceremony = useCallback(
    async (run: (c: CalimeroClient) => Promise<{ accountId: string }>) => {
      if (state.status !== 'signed-out') return;
      setBusy(true);
      setError(null);
      try {
        const { accountId } = await run(state.client);
        store?.sync(state.client);
        setState({
          status: 'signed-in',
          client: state.client,
          target: state.target,
          accountId,
        });
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [state, store],
  );

  const signIn = useCallback(
    () => ceremony((c) => c.signIn(deps.passkey())),
    [ceremony, deps],
  );
  const signUp = useCallback(
    (name: string) => ceremony((c) => c.signUp(deps.passkey(), name)),
    [ceremony, deps],
  );
  const signOut = useCallback(async () => {
    if (state.status !== 'signed-in') return;
    try {
      await state.client.signOut();
    } catch {
      // Already expired or unreachable: forgetting it here is what matters.
    }
    store?.clear();
    setState({
      status: 'signed-out',
      client: state.client,
      target: state.target,
    });
  }, [state, store]);

  const client =
    state.status === 'signed-in' || state.status === 'signed-out'
      ? state.client
      : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  const value = useMemo<Calimero>(() => {
    const target =
      state.status === 'signed-in' || state.status === 'signed-out'
        ? state.target
        : null;
    return {
      status: state.status,
      client,
      target,
      accountId: state.status === 'signed-in' ? state.accountId : null,
      source,
      message: state.status === 'unconfigured' ? state.message : null,
      error,
      busy,
      isAuthenticated: state.status === 'signed-in',
      isLoading: state.status === 'connecting',
      where: describeTarget(target),
      signIn,
      signUp,
      signOut,
      passkey: deps.passkey,
      after,
    };
  }, [
    state,
    client,
    source,
    error,
    busy,
    signIn,
    signUp,
    signOut,
    deps,
    after,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCalimero(): Calimero {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCalimero outside <CalimeroProvider>');
  return value;
}

/** For tests and screens that render without the provider. */
export const CalimeroContext = Ctx;
