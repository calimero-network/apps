// Aliased over @calimero-network/mero-react. The pages need a session-shaped
// object to render; nothing here reaches a node.
const APP_ID = 'app-mero-pass';

// ONE object, as mero-react's context value is. A fresh `mero` per call re-ran
// every effect that lists it (the vault page's lookup, for one) on every render
// — an endless render loop that froze the page on the first real click.
const SESSION = {
  mero: {
    admin: {
      listAccountDevices: async () => [
        {
          deviceId: '9c1f2e7a5b3d8f0e1a2b3c4d5e6f708192a3b4c5',
          isSelf: true,
          revoked: false,
          namespaces: ['ns-1', 'ns-p'],
        },
        {
          deviceId: '4e8d1c0b9a7f6e5d4c3b2a1908f7e6d5c4b3a291',
          isSelf: false,
          revoked: false,
          namespaces: ['ns-1'],
        },
      ],
    },
  },
  nodeUrl: 'https://node-7.calimero.network:2528',
  logout: () => {},
  applicationId: APP_ID,
  isAuthenticated: true,
  isLoading: false,
};

export function useMero() {
  return SESSION;
}

const IDENTITY = { identity: { accountId: 'a'.repeat(64) }, loading: false };

export function useNodeIdentity() {
  return IDENTITY;
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

/** Live updates: nothing arrives in the harness. */
export function useSubscription() {}
