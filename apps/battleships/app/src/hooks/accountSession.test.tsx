// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Battleships on a cloud-account (delegated) session ──────────────────────
//
// On an account `useMero().mero` is the relay client, and `mero.admin` is the
// relay's own node API: it refuses an account's writes (403) and answers
// "owned identities" with the relay's. Everything here goes through the
// session admin, `useMero().admin`. And the account's application id lands
// from the registry after sign-in, so an empty lobby list before then (or a
// failed one) is not "no lobbies".

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NS = 'a1'.repeat(32);
const LOBBY = 'c1'.repeat(32);
const ME = 'd4'.repeat(32);

const h = vi.hoisted(() => {
  const admin = {
    createNamespace: vi.fn(),
    setDefaultCapabilities: vi.fn(),
    createContext: vi.fn(),
    getContext: vi.fn(),
    getContextIdentitiesOwned: vi.fn(),
    getContextIdentities: vi.fn(),
  };
  // Every call on the raw client fails the way a relay refuses an account.
  const raw = new Proxy(
    {},
    { get: (_t, prop) => vi.fn(async () => { throw new Error(`403 raw mero.admin.${String(prop)}`); }) },
  );
  const session = {
    mero: { admin: raw, rpc: {} },
    admin,
    isDelegated: true,
    applicationId: 'app-from-registry' as string | null,
    contextIdentity: null,
  };
  const ns = {
    namespaces: [] as { namespaceId: string; targetApplicationId: string; name?: string }[],
    loading: false,
    error: null as Error | null,
    calledWith: [] as (string | null)[],
  };
  return { admin, session, ns };
});

vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
  useNamespacesForApplication: (appId: string | null) => {
    h.ns.calledWith.push(appId);
    return { namespaces: h.ns.namespaces, loading: h.ns.loading, error: h.ns.error, refetch: vi.fn() };
  },
  useGroupContexts: (groupId: string | null) => ({
    contexts: groupId ? [{ contextId: LOBBY }] : [],
    loading: false,
    refetch: vi.fn(),
  }),
  useGroupMembers: () => ({ members: [], loading: false, refetch: vi.fn() }),
  useCreateNamespaceInvitation: () => ({ createNamespaceInvitation: vi.fn(), loading: false }),
  useNodeIdentity: () => ({ identity: { accountId: ME }, refetch: vi.fn() }),
}));

vi.mock('../generated/lobby/LobbyClient', () => ({
  LobbyClient: class {
    getPlayers = async () => [];
    registerPlayer = async () => undefined;
  },
}));

const { useNamespaceBootstrap } = await import('./useNamespaceBootstrap');
const { useBattleshipsLobby, useAnswered } = await import('./useBattleshipsLobby');
const { default: LobbySelect } = await import('../components/LobbySelect');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook<T>(hook: () => T): { current: () => T; rerender: () => Promise<void> } {
  let value: T;
  function Probe() {
    value = hook();
    return null;
  }
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root!.render(createElement(Probe)));
  return {
    current: () => value,
    rerender: async () => {
      await act(async () => root!.render(createElement(Probe)));
    },
  };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.session.applicationId = 'app-from-registry';
  h.ns.namespaces = [];
  h.ns.loading = false;
  h.ns.error = null;
  h.ns.calledWith = [];
  h.admin.createNamespace.mockResolvedValue({ namespaceId: NS });
  h.admin.setDefaultCapabilities.mockResolvedValue(undefined);
  h.admin.createContext.mockResolvedValue({ contextId: LOBBY, memberPublicKey: ME });
  h.admin.getContext.mockResolvedValue({ serviceName: 'lobby' });
  h.admin.getContextIdentitiesOwned.mockResolvedValue({ identities: [ME] });
  h.admin.getContextIdentities.mockResolvedValue({ identities: [ME] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
});

describe('creating a lobby on an account', () => {
  it('founds the namespace and the lobby context through the session admin', async () => {
    const hook = renderHook(() => useNamespaceBootstrap('app-from-registry'));
    let result: unknown;
    await act(async () => {
      result = await hook.current().createNamespaceWithLobby('Harbour');
    });
    expect(result).toEqual({ namespaceId: NS, lobbyContextId: LOBBY, memberPublicKey: ME });
    expect(h.admin.createNamespace).toHaveBeenCalledWith({ applicationId: 'app-from-registry', name: 'Harbour' });
    expect(h.admin.setDefaultCapabilities).toHaveBeenCalledWith(NS, { defaultCapabilities: 11 });
    expect(h.admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'app-from-registry', groupId: NS, serviceName: 'lobby' }),
    );
  });

  it('does not create one before the application id has landed, and says why', async () => {
    const hook = renderHook(() => useNamespaceBootstrap(null));
    let failure: unknown;
    await act(async () => {
      failure = await hook.current().createNamespaceWithLobby('Harbour').catch((e: unknown) => e);
    });
    expect(String(failure)).toMatch(/Still connecting/);
    expect(h.admin.createNamespace).not.toHaveBeenCalled();
  });

  it('rejects with the reason, so the first failure is shown', async () => {
    h.admin.createNamespace.mockRejectedValue(new Error('createNamespace without a packageName is not available for an account'));
    const hook = renderHook(() => useNamespaceBootstrap('app-from-registry'));
    let failure: unknown;
    await act(async () => {
      failure = await hook.current().createNamespaceWithLobby('Harbour').catch((e: unknown) => e);
    });
    expect(String(failure)).toMatch(/packageName/);
  });
});

describe('the lobby list on an account', () => {
  it('waits for the registry id instead of reading an empty list as no lobbies', async () => {
    h.session.applicationId = null;
    const hook = renderHook(() => useBattleshipsLobby());
    await flush();
    expect(h.ns.calledWith.every((id) => id === null)).toBe(true);
    expect(hook.current().lobbies).toEqual([]);
    expect(hook.current().lobbiesLoading).toBe(true);
    expect(hook.current().lobbiesAnswered).toBe(false);
  });

  it('reads the lobby context and its owned identity through the session admin', async () => {
    h.ns.namespaces = [{ namespaceId: NS, targetApplicationId: 'app-from-registry', name: 'Harbour' }];
    const hook = renderHook(() => useBattleshipsLobby());
    await flush();
    await flush();
    expect(h.admin.getContext).toHaveBeenCalledWith(LOBBY);
    expect(h.admin.getContextIdentitiesOwned).toHaveBeenCalledWith(LOBBY);
    expect(hook.current().lobbyContextId).toBe(LOBBY);
    expect(hook.current().executorPublicKey).toBe(ME);
  });
});

describe('useAnswered', () => {
  it('is false for a failed list and true only after a successful one', async () => {
    const state = { loading: false, error: null as Error | null };
    const hook = renderHook(() => useAnswered(state.loading, state.error, ['app']));
    expect(hook.current()).toBe(false);
    state.loading = true;
    await hook.rerender();
    state.loading = false;
    state.error = new Error('relay unreachable');
    await hook.rerender();
    expect(hook.current()).toBe(false);
    state.loading = true;
    state.error = null;
    await hook.rerender();
    state.loading = false;
    await hook.rerender();
    expect(hook.current()).toBe(true);
  });
});

describe('a failed lobby list', () => {
  it('offers a retry, not "no fleets", and holds back create', () => {
    const html = renderToStaticMarkup(
      createElement(LobbySelect, {
        lobbies: [],
        lobbiesLoading: false,
        lobbiesFailed: true,
        onRetryLobbies: vi.fn(),
        selectedNamespaceId: null,
        lobbyContextId: null,
        namespaceId: null,
        createLobbyLoading: false,
        newLobbyName: 'Harbour',
        onNewLobbyNameChange: vi.fn(),
        onSelectLobby: vi.fn(),
        onCreateLobby: vi.fn(),
        onEnter: vi.fn(),
      }),
    );
    expect(html).toContain('data-testid="lobbies-failed"');
    expect(html).not.toContain('lobby-empty-headline">No fleets in port');
    expect(html).toMatch(/<button type="submit" class="btn-deploy" disabled=""/);
  });
});
