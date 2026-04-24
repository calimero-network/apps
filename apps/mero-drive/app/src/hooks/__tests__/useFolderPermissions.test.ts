import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';

// useFolderPermissions delegates to useMemberCaps, which now reads
// capabilities via mero-react's useGroupCapabilities and identity
// via useDriveWorkspace. Both mocked here; tests drive the caps value
// directly.
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

const identityMock: { value: string | null } = { value: 'me' };
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: identityMock.value,
    loading: false,
    error: null,
  }),
}));

describe('useFolderPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.value = 'me';
    capsMock.value = { capabilities: 0, loading: false, error: null };
  });

  const render = (caps: number) => {
    capsMock.value = { capabilities: caps, loading: false, error: null };
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('READ permits canRead only', async () => {
    const { result } = render(CAP.READ);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('WRITE permits write, not delete', async () => {
    const { result } = render(CAP.READ | CAP.WRITE);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canDelete).toBe(false);
  });

  it('MANAGE_GROUP permits delete + rename + visibility', async () => {
    const { result } = render(CAP.MANAGE_GROUP);
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });

  it('exposes error when cap fetch fails — distinguishes from legitimate zero caps', async () => {
    const boom = new Error('network down');
    capsMock.value = { capabilities: null, loading: false, error: boom };
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-x'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.canRead).toBe(false);
  });

  it('loading=true when caps are still resolving', async () => {
    capsMock.value = { capabilities: null, loading: true, error: null };
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.canRead).toBe(false);
  });
});
