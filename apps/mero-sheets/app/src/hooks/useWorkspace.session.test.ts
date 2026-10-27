// @vitest-environment jsdom
/**
 * useWorkspace on a cloud-account (delegated) session, and the readiness rules
 * that keep it from founding a duplicate workspace on either session.
 *
 * On an account `mero` is the relay client: its node routes (create a
 * namespace or context, join) refuse an account (403), and the node-wide
 * application listing is refused too. Everything goes through `useMero().admin`,
 * and the application id is the provider's registry-derived one, which lands
 * AFTER sign-in. These drive the real hook and the real `useApplicationId`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { APP_PACKAGE } from '../config';

const h = vi.hoisted(() => ({
  session: {
    isDelegated: true,
    applicationId: 'app-from-registry' as string | null,
  },
  namespaces: [] as { namespaceId: string; name: string }[],
  nsError: null as Error | null,
  listedWith: [] as (string | null)[],
}));

// The session admin: what every call has to go through.
const admin = {
  listApplications: vi.fn(async () => ({ apps: [{ id: 'app-on-node', package: APP_PACKAGE }] })),
  createNamespace: vi.fn(async () => ({ namespaceId: 'ns-new' })),
  setDefaultCapabilities: vi.fn(async () => undefined),
  createContext: vi.fn(async () => ({ contextId: 'ctx-new', memberPublicKey: 'acct' })),
  setContextMetadata: vi.fn(async () => undefined),
  getContextMetadata: vi.fn(async () => null),
  getContextIdentitiesOwned: vi.fn(async () => ({ identities: ['acct'] })),
};
// The raw relay client's admin: any call here is a 403 on a real relay.
const rawAdmin = new Proxy(
  {},
  {
    get: (_t, prop) => () => {
      throw new Error(`raw mero.admin.${String(prop)} called`);
    },
  },
);
const mero = { admin: rawAdmin };

function useFakeRead<T>(read: () => { data: T; error: Error | null }, key: unknown) {
  const [state, setState] = useState(() => ({ ...read(), loading: true }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => setState({ ...read(), loading: false }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, key]);
  return { ...state, refetch: async () => setTick((t) => t + 1) };
}

vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@calimero-apps/cloud')>()),
  useMero: () => ({
    mero,
    admin,
    nodeUrl: 'https://relay.example',
    isDelegated: h.session.isDelegated,
    applicationId: h.session.applicationId,
    contextId: null,
    contextIdentity: null,
  }),
  useNamespacesForApplication: (applicationId: string | null) => {
    const { data, error, loading, refetch } = useFakeRead(() => {
      if (!applicationId) return { data: [], error: null };
      h.listedWith.push(applicationId);
      return h.nsError ? { data: [], error: h.nsError } : { data: h.namespaces, error: null };
    }, applicationId);
    return { namespaces: data, error, loading: applicationId ? loading : false, refetch };
  },
  useGroupContexts: (namespaceId: string | null) => {
    const { data, loading, refetch } = useFakeRead(() => ({ data: [], error: null }), namespaceId);
    return { contexts: data, loading: namespaceId ? loading : false, refetch };
  },
}));

const { useWorkspace } = await import('./useWorkspace');
const { clearApplicationIdCache } = await import('./useApplicationId');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearApplicationIdCache();
  h.session.isDelegated = true;
  h.session.applicationId = 'app-from-registry';
  h.namespaces = [];
  h.nsError = null;
  h.listedWith = [];
});

afterEach(() => cleanup());

describe('useWorkspace on a cloud account', () => {
  it('takes the registry id and never asks the node-wide application list', async () => {
    const { result } = renderHook(() => useWorkspace());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(h.listedWith).toContain('app-from-registry');
    expect(admin.listApplications).not.toHaveBeenCalled();
    expect(result.current.notInstalled).toBe(false);
  });

  it('creates the workspace and spreadsheet through the session admin, not the relay client', async () => {
    const { result } = renderHook(() => useWorkspace());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    await act(() => result.current.createWorkspace('Q3 Budget'));
    expect(result.current.error).toBeNull();
    expect(admin.createNamespace).toHaveBeenCalledWith({
      applicationId: 'app-from-registry',
      name: expect.any(String),
    });
    expect(admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'app-from-registry', groupId: 'ns-new' }),
    );
    expect(result.current.contextId).toBe('ctx-new');
  });

  it('waits for the application id instead of reading "not installed" or offering create', async () => {
    h.session.applicationId = null;
    const { result, rerender } = renderHook(() => useWorkspace());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.notInstalled).toBe(false);
    expect(result.current.canCreate).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(() => result.current.createWorkspace('Too early'));
    expect(admin.createNamespace).not.toHaveBeenCalled();

    h.session.applicationId = 'app-from-registry';
    rerender();
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(h.listedWith).toEqual(['app-from-registry']);
  });
});

describe('a failed workspace list', () => {
  for (const delegated of [true, false]) {
    it(`is not "no workspace": create stays off (${delegated ? 'account' : 'node'})`, async () => {
      h.session.isDelegated = delegated;
      h.nsError = new Error('relay unreachable');
      const { result } = renderHook(() => useWorkspace());
      await waitFor(() => expect(result.current.namespacesFailed).toBe(true));
      expect(result.current.canCreate).toBe(false);
      await act(() => result.current.createWorkspace('Duplicate'));
      expect(admin.createNamespace).not.toHaveBeenCalled();

      // A retry that answers turns create back on.
      h.nsError = null;
      act(() => result.current.retryNamespaces());
      await waitFor(() => expect(result.current.canCreate).toBe(true));
      expect(result.current.namespacesFailed).toBe(false);
    });
  }
});

describe('useWorkspace on a node login', () => {
  it('still resolves the id from the node, through the session admin', async () => {
    h.session.isDelegated = false;
    h.session.applicationId = 'stale-from-another-app';
    const { result } = renderHook(() => useWorkspace());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(admin.listApplications).toHaveBeenCalled();
    expect(h.listedWith).toContain('app-on-node');
    expect(h.listedWith).not.toContain('stale-from-another-app');
  });
});
