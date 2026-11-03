import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import { appSource, type AppSource, type Target } from '@calimero-apps/connect';

import { PACKAGE_NAME } from './constants/config';
import { setSignSession } from './lib/node';
import {
  defaultDeps,
  useSession,
  type SessionApi,
  type SessionDeps,
} from './session';

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where instances come from: the dev bundle, or the package in production. */
  source: AppSource;
  /** The passkey sign-in dialog. */
  signInOpen: boolean;
  openSignIn: () => void;
  closeSignIn: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** What a signed-in screen needs. */
export interface SignedIn {
  client: CalimeroClient;
  accountId: string;
  target: Target;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Run after each request: keeps the stored session current (refresh tokens are single-use). */
  after: () => void;
  signOut: () => Promise<void>;
}

/**
 * Connects once (merod local in dev, the Cloud cluster in production) and
 * shares the session with every screen. Replaces v1's `MeroProvider`,
 * `LoginGate` and `MeroBridge`: the services that are not components read the
 * same session through `lib/node`'s `signSession()`.
 */
export function SessionProvider({
  deps = defaultDeps,
  children,
}: {
  deps?: SessionDeps;
  children: ReactNode;
}) {
  const api = useSession(deps);
  const source = useMemo(() => appSource(deps.env, PACKAGE_NAME), [deps.env]);
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = useCallback(() => setSignInOpen(true), []);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);

  // Registered during render, before any screen's effect reads it.
  const { session, store } = api;
  const client = session.status === 'signed-in' ? session.client : null;
  useMemo(() => {
    if (session.status !== 'signed-in') {
      setSignSession(null);
      return;
    }
    setSignSession({
      client: session.client,
      accountId: session.accountId,
      target: session.target,
      source,
      passkey: deps.passkey,
      after: () => {
        if (client) store?.sync(client);
      },
    });
  }, [session, store, client, source, deps.passkey]);

  const value = useMemo(
    () => ({ api, deps, source, signInOpen, openSignIn, closeSignIn }),
    [api, deps, source, signInOpen, openSignIn, closeSignIn],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSessionApi(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSessionApi outside <SessionProvider>');
  return value;
}

/** The signed-in session, or null while there is none. */
export function useMaybeSignedIn(): SignedIn | null {
  const { api, deps, source } = useSessionApi();
  const { session, store, signOut } = api;
  const signedIn = session.status === 'signed-in' ? session : null;
  const client = signedIn?.client ?? null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);
  return useMemo(
    () =>
      signedIn
        ? {
            client: signedIn.client,
            accountId: signedIn.accountId,
            target: signedIn.target,
            source,
            passkey: deps.passkey,
            after,
            signOut,
          }
        : null,
    [signedIn, source, deps.passkey, after, signOut],
  );
}
