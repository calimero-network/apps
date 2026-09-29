import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderMembership } from '../useFolderMembership';

const listGroupMembers = vi.fn();
const MERO_STUB = { mero: { admin: { listGroupMembers } } };
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => MERO_STUB,
  useAddGroupMembers: () => ({ addGroupMembers: vi.fn() }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn() }),
}));
vi.mock('../useContextEvents', () => ({ useContextEvents: vi.fn() }));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryContextId: 'registry-ctx' }),
}));

describe('useFolderMembership', () => {
  it('surfaces the members list the admin client returns', async () => {
    const rows = [{ identity: 'a'.repeat(64), role: 'Admin' }];
    listGroupMembers.mockResolvedValue({ members: rows });
    const { result } = renderHook(() => useFolderMembership('folder-1'));
    await waitFor(() => expect(result.current.readFor).toBe('folder-1'));
    expect(listGroupMembers).toHaveBeenCalledWith('folder-1');
    expect(result.current.members).toEqual(rows);
  });

  it('reports the failure and keeps the previous read', async () => {
    listGroupMembers.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useFolderMembership('folder-2'));
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.readFor).toBeNull();
  });
});
