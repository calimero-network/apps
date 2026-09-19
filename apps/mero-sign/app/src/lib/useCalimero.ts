/**
 * `useCalimero()`, backed by mero-react instead of `calimero-client`.
 *
 * Twelve files in this app call `useCalimero()` for one of four things: `app`,
 * `isAuthenticated`, `login`, `logout`. Keeping that shape means the SDK swap
 * is a change of import line in those twelve files, and nothing else — which
 * matters because two of them are on the signing path.
 *
 * ⚠️ `login()` IS THE WHOLE POINT OF THE MIGRATION. The old
 * `useCalimero().login()` opened `calimero-client`'s hardcoded `SetupModal`:
 *
 *     Select your Calimero node type to continue.
 *     ( ) Local  ( ) Remote
 *     Using default local node: http://node1.127.0.0.1.nip.io
 *
 * No prop removes it — it is built into that SDK. So it survived being wrapped
 * in a nicer dialog, survived the dialog being deleted, and survived the second
 * connect screen being fixed, because none of those were the thing rendering
 * it. `login()` here opens the LoginModal every other app in this repo uses.
 */
import { useMemo } from 'react';
import { useMero } from '@calimero-network/mero-react';

import { useOpenLogin } from './loginGate';
import { meroApp, type MeroAppLike } from './meroApp';

export interface CalimeroLike {
  /** The data layer's duck-typed client. Null until a node is connected. */
  app: MeroAppLike | null;
  isAuthenticated: boolean;
  /** Opens the node picker. See the warning above. */
  login: () => void;
  logout: () => void;
}

export function useCalimero(workspaceId?: string | null): CalimeroLike {
  const { mero, isAuthenticated, logout } = useMero();
  // Resolved lazily; see `meroApp`. Both are supplied by the screen that knows
  // them — the workspace a new agreement belongs to is a property of where you
  // are in the app, not of the session.
  const appId: string | null = null;
  const login = useOpenLogin();

  const app = useMemo(
    () => (mero ? meroApp(mero, appId ?? null, workspaceId ?? null) : null),
    [mero, appId, workspaceId],
  );

  return { app, isAuthenticated, login, logout };
}
