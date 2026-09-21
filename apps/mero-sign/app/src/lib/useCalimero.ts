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

import { useActiveWorkspace } from './activeWorkspace';
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

/**
 * @param workspaceId overrides the active workspace for this caller. Only the
 *   agreements screen passes one — it is routed by `/workspaces/:workspaceId`
 *   and therefore knows its workspace a render before the store does. Everyone
 *   else gets whatever workspace the app is currently in.
 */
export function useCalimero(workspaceId?: string | null): CalimeroLike {
  const { mero, isAuthenticated, logout } = useMero();
  const activeWorkspace = useActiveWorkspace();
  const login = useOpenLogin();

  // ⚠️ `undefined` and `null` MEAN DIFFERENT THINGS here. Omitting the argument
  // is "use the app's current workspace"; passing `null` is "deliberately
  // outside one", which is what the landing and signature screens want. `??`
  // keeps that distinction — `||` would silently turn the second into the
  // first.
  const effective = workspaceId === undefined ? activeWorkspace : workspaceId;

  const app = useMemo(
    () => (mero ? meroApp(mero, effective) : null),
    [mero, effective],
  );

  return { app, isAuthenticated, login, logout };
}
