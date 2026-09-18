// `@calimero-network/calimero-client`, replaced for the harness.
//
// The SDK reaches a node for everything, and it also ships CommonJS under
// `"type": "module"`, which Node's ESM resolver refuses — so aliasing it is both
// what makes the screenshots node-free and what makes the harness build at all.
import { current, SIGNATURE_PNG } from './fixtures';

// ⚠️ STABLE IDENTITIES. Every page does
// `useMemo(() => new ClientApiDataSource(app), [app])` and then depends on that
// service in a load effect — so returning a fresh object from this hook on each
// render re-creates the service, re-runs the effect, re-renders, forever. The
// signatures screen photographed "Loading…" for exactly that reason, while the
// harness reported the card as found: it HAD rendered, and then the next loop
// iteration put it back.
const APP = { fetchContexts: async () => [] };
const SESSION = {
  isAuthenticated: current.authed,
  app: current.authed ? APP : null,
  logout: () => {},
};

export const useCalimero = () => SESSION;

export const getAppEndpointKey = () => 'https://node-7.calimero.network:2528';
export const getContextId = () => 'ctx-1';
export const getExecutorPublicKey = () => 'a0'.repeat(32);
export const setContextId = () => {};
export const setExecutorPublicKey = () => {};

export const apiClient = {
  node: () => ({
    contextInviteByOpenInvitation: async () => ({
      data: { data: { invitation: {}, inviterSignature: 'ff' } },
      error: null,
    }),
    createNewIdentity: async () => ({
      data: { publicKey: 'b0'.repeat(32) },
      error: null,
    }),
    getInstalledApplications: async () => ({
      data: { data: { apps: [] } },
      error: null,
    }),
  }),
};

export const blobClient = {
  uploadBlob: async () => ({ data: { blobId: 'blob-new' }, error: null }),
  downloadBlob: async () =>
    // A real Blob, so the page's FileReader path runs exactly as it does live.
    await (await fetch(SIGNATURE_PNG)).blob(),
};

export const rpcClient = {
  execute: async () => ({ result: { output: null } }),
};
export const getAuthConfig = () => ({
  contextId: 'ctx-1',
  executorPublicKey: 'a0'.repeat(32),
});
export const AppMode = { MultiContext: 'MultiContext' } as const;
export const CalimeroProvider = ({ children }: { children: unknown }) =>
  children;
export const CalimeroConnectButton = () => null;
export type ResponseData<T> = {
  data: T | null;
  error: { message?: string } | null;
};
