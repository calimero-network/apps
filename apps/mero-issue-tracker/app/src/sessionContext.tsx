import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import { appSource, type AppSource, type Target } from '@calimero-apps/connect';
import { useResolvedSource } from '@calimero-apps/passkey';

import { APP_PACKAGE } from './config';
import { defaultDeps, useSession, type SessionApi, type SessionDeps } from './session';

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where instances come from: the dev bundle, or the package release in production. */
  source: AppSource;
  /** Signed in, with the package's newest release still being read: `source` is not final, so nothing is created yet. */
  sourcePending: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Connects once (local nodes in dev, the Cloud cluster in production) and
 * shares the session with every screen. Replaces v1's `MeroProvider`.
 */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps);
  const base = useMemo(() => appSource(deps.env, APP_PACKAGE), [deps.env]);
  const signedIn = api.session.status === 'signed-in' ? api.session : null;
  const { source, pending: sourcePending } = useResolvedSource(signedIn?.client ?? null, signedIn?.accountId ?? null, base);
  const value = useMemo(() => ({ api, deps, source, sourcePending }), [api, deps, source, sourcePending]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionApi(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSessionApi outside <SessionProvider>');
  return value;
}

/** What a signed-in screen needs. */
export interface SignedIn {
  client: CalimeroClient;
  accountId: string;
  target: Target;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** The package's newest release is still being read: the create paths wait for it. */
  sourcePending: boolean;
  /** Run after each request: keeps the stored session current (refresh tokens are single-use). */
  after: () => void;
}

/** The signed-in session; only under the route guard, which renders nothing until there is one. */
export function useSignedIn(): SignedIn {
  const { api, deps, source, sourcePending } = useSessionApi();
  const { session, store } = api;
  const signedIn = session.status === 'signed-in' ? session : null;
  const client = signedIn?.client ?? null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);
  const value = useMemo(
    () =>
      signedIn
        ? {
            client: signedIn.client,
            accountId: signedIn.accountId,
            target: signedIn.target,
            source,
            sourcePending,
            passkey: deps.passkey,
            after,
          }
        : null,
    [signedIn, source, sourcePending, deps.passkey, after],
  );
  if (!value) throw new Error('useSignedIn without a session');
  return value;
}
