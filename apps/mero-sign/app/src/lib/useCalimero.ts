/**
 * `useCalimero()`: the four things the screens ask of the session — `app`,
 * `isAuthenticated`, `login`, `logout` — now from `@calimero-apps/connect`
 * and a passkey instead of mero-react and a node.
 *
 * `app` is the signed-in session (null until there is one). The data sources
 * take it so a screen re-reads when the account changes; the requests
 * themselves go through `lib/node`'s session.
 */
import { useCallback } from 'react';

import { useMaybeSignedIn, useSessionApi, type SignedIn } from '../sessionContext';

export interface CalimeroLike {
  app: SignedIn | null;
  isAuthenticated: boolean;
  /** Opens the passkey sign-in. */
  login: () => void;
  logout: () => void;
}

/**
 * The argument is v1's workspace override. Kept so call sites read the same;
 * an instance carries its org, so nothing here depends on it.
 */
export function useCalimero(_workspaceId?: string | null): CalimeroLike {
  const { api, openSignIn } = useSessionApi();
  const app = useMaybeSignedIn();
  const { signOut } = api;
  const logout = useCallback(() => {
    void signOut();
  }, [signOut]);
  return {
    app,
    isAuthenticated: api.session.status === 'signed-in',
    login: openSignIn,
    logout,
  };
}
