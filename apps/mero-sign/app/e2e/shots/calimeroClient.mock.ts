// `@calimero-network/calimero-client`, replaced for the harness.
//
// The SDK reaches a node for everything, and it also ships CommonJS under
// `"type": "module"`, which Node's ESM resolver refuses — so aliasing it is both
// what makes the screenshots node-free and what makes the harness build at all.
import {
  ALICE,
  current,
  SIGNATURE_PNG,
  SUBGROUPS,
  WORKSPACES,
} from './fixtures';

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
    // ⚠️ MUST carry `package`. `lib/appId` matches on it and deliberately
    // does NOT fall back to `apps[0]`, so an empty list resolves to "" and
    // every screen built on the workspace model photographs "Mero Sign is not
    // installed on this node" instead of itself.
    getInstalledApplications: async () => ({
      data: {
        data: {
          apps: [
            {
              id: 'app-1',
              package: 'com.calimero.mero-sign',
              version: '1.0.0',
            },
          ],
        },
      },
      error: null,
    }),
  }),
};

// ── `mero.admin`, for the screens built on the workspace model ──────────────
//
// `lib/agreements` calls the admin surface directly rather than through the
// six-method shim, so the harness has to answer it here too. What it serves is
// the shape those functions destructure — a namespace listing, its subgroups,
// each subgroup's context, and metadata — not a general-purpose fake node.
//
// ⚠️ `getGroupMetadata` returns `data: {}`, NOT the personal marker. A record
// carrying `kind: 'mero-sign:personal'` is filtered out of `listWorkspaces`,
// so marking these would photograph an empty picker.
const EMPTY: never[] = [];

export const adminApi = () => ({
  listNamespacesForApplication: async () =>
    current.workspaces === 'none' ? EMPTY : WORKSPACES,
  getGroupMetadata: async () => ({ name: null, data: {} }),
  listNamespaceGroups: async () => {
    if (current.agreements === 'error') {
      throw new Error('Could not reach your node to list this workspace.');
    }
    return current.agreements === 'none' ? EMPTY : SUBGROUPS;
  },
  listGroupContexts: async (groupId: string) => {
    const sg = SUBGROUPS.find((g) => g.groupId === groupId);
    return sg ? [{ contextId: sg.contextId, name: sg.name }] : EMPTY;
  },
  listGroupMembers: async () => ({
    members: [{ accountId: ALICE }, { accountId: 'b0'.repeat(32) }],
  }),
  getContextIdentitiesOwned: async () => ({ identities: [ALICE] }),
  joinSubgroupInheritance: async () => ({
    groupId: 'sg-1',
    memberPublicKey: ALICE,
    wasInherited: true,
  }),
  createNamespace: async () => ({ namespaceId: 'ns-new' }),
  setGroupMetadata: async () => {},
  setDefaultCapabilities: async () => {},
  setMemberCapabilities: async () => {},
  getMemberCapabilities: async () => null,
  setSubgroupVisibility: async () => {},
  createGroupInNamespace: async () => ({ groupId: 'sg-new' }),
  createContext: async () => ({ contextId: 'ctx-new', memberPublicKey: ALICE }),
  listApplications: async () => ({ apps: [] }),
});

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
