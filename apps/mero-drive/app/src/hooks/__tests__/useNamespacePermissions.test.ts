import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNamespacePermissions } from '../useNamespacePermissions';
import { CAP } from '../../constants/config';

// useNamespacePermissions goes through useMemberCaps, which now
// reads via mero-react's useGroupCapabilities.
const capsMock: { value: { capabilities: number | null; loading: boolean; error: Error | null } } = {
  value: { capabilities: 0, loading: false, error: null },
};
vi.mock('@calimero-network/mero-react', () => ({
  useGroupCapabilities: () => capsMock.value,
  useGroupMembers: () => ({
    members: [],
    selfIdentity: 'me',
    loading: false,
    error: null,
  }),
}));

vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: 'me',
    loading: false,
    error: null,
  }),
}));

describe('useNamespacePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capsMock.value = { capabilities: 0, loading: false, error: null };
  });

  it('derives canCreateSubgroup from CREATE_GROUP bit', async () => {
    capsMock.value = { capabilities: CAP.CREATE_GROUP, loading: false, error: null };
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canCreateSubgroup).toBe(true);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('canManageNamespace requires MANAGE_GROUP', async () => {
    capsMock.value = { capabilities: CAP.MANAGE_GROUP, loading: false, error: null };
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
  });

  it('loading while caps resolve', () => {
    capsMock.value = { capabilities: null, loading: true, error: null };
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    expect(result.current.loading).toBe(true);
    expect(result.current.canCreateSubgroup).toBe(false);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('exposes error when cap fetch fails — distinguishes from legitimate zero caps', async () => {
    const boom = new Error('network down');
    capsMock.value = { capabilities: null, loading: false, error: boom };
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.canManageNamespace).toBe(false);
  });
});
