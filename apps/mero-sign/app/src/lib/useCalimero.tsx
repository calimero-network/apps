import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { appSource } from '@calimero-apps/connect';

import { setConn, type Conn } from './conn';
import { PACKAGE } from './meroSign';
import { defaultDeps, useSession, type SessionApi, type SessionDeps } from './session';
import { setActiveWorkspace } from './activeWorkspace';
import SignInDialog from '../components/SignInDialog';

export interface CalimeroLike {
  /** The signed-in connection; null until someone signs in. */
  app: Conn | null;
  isAuthenticated: boolean;
  /** Who is signed in. */
  accountId: string | null;
  /** Opens the passkey sign-in. */
  login: () => void;
  logout: () => void;
  session: SessionApi;
}

const Ctx = createContext<CalimeroLike | null>(null);

/**
 * The session for the whole app: mero-js's `CalimeroClient` through
 * `@calimero-apps/connect`, against `merod local` under `vite` and Calimero
 * Cloud in a production build. Replaces mero-react's `MeroProvider`.
 */
export function CalimeroProvider({
  children,
  deps = defaultDeps,
}: {
  children: ReactNode;
  deps?: SessionDeps;
}) {
  const session = useSession(deps);
  const [loginOpen, setLoginOpen] = useState(false);
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const { session: s, store } = session;

  const app = useMemo<Conn | null>(() => {
    if (s.status !== 'signed-in') return null;
    const client = s.client;
    return {
      client,
      accountId: s.accountId,
      target: s.target,
      source,
      passkey: deps.passkey,
      after: () => store?.sync(client),
    };
  }, [s, source, deps.passkey, store]);

  // Set during render, not in an effect: the services children call in their
  // own first effects read it.
  setConn(app);
  useEffect(() => () => setConn(null), []);
  useEffect(() => {
    if (app) setLoginOpen(false);
  }, [app]);

  const login = useCallback(() => setLoginOpen(true), []);
  const logout = useCallback(() => {
    setActiveWorkspace(null);
    void session.signOut();
  }, [session]);

  const value = useMemo<CalimeroLike>(
    () => ({
      app,
      isAuthenticated: !!app,
      accountId: app?.accountId ?? null,
      login,
      logout,
      session,
    }),
    [app, login, logout, session],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <SignInDialog
        open={loginOpen && !app}
        onClose={() => setLoginOpen(false)}
        session={session}
      />
    </Ctx.Provider>
  );
}

/** The session, from `CalimeroProvider`. */
export function useCalimero(): CalimeroLike {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCalimero outside CalimeroProvider');
  return value;
}
