// Aliased over @calimero-network/mero-react. The pages need a session-shaped
// object to render; nothing here reaches a node.
const APP_ID = 'app-mero-pass';

export function useMero() {
  return {
    mero: { admin: {} },
    nodeUrl: 'https://node-7.calimero.network:2528',
    logout: () => {},
    applicationId: APP_ID,
    isAuthenticated: true,
    isLoading: false,
  };
}

export function useNodeIdentity() {
  return { identity: { accountId: 'a'.repeat(64) }, loading: false };
}

export const AppMode = { MultiContext: 'MultiContext' } as const;
export function MeroProvider({ children }: { children: unknown }) {
  return children as never;
}
export function ConnectButton() {
  return null;
}

/** The landing page's connect popup. Rendered as nothing in the harness. */
export function LoginModal() {
  return null;
}
