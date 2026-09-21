/**
 * mero-react, stubbed for the screenshot harness.
 *
 * `MeroProvider` opens a connection to a node on mount and `LoginModal`
 * discovers local ones; neither can run with no node. Everything the app reads
 * through them is either aliased here or supplied by `calimeroClient.mock`.
 */
import type { ReactNode } from 'react';

export const AppMode = { MultiContext: 'MultiContext' } as const;

export function MeroProvider({ children }: { children: ReactNode }) {
  return children as JSX.Element;
}

/** Never opened in a shot: the scenarios are about the signed-in screens. */
export function LoginModal() {
  return null;
}

export const useMero = () => ({
  mero: null,
  isAuthenticated: true,
  connectToNode: () => {},
  logout: () => {},
});

export const useNodeIdentity = () => ({
  identity: { accountId: 'a'.repeat(64) },
});
