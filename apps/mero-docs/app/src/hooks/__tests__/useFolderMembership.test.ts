import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderMembership } from '../useFolderMembership';

const listGroupMembers = vi.fn();
const MERO_STUB = { mero: {}, admin: { listGroupMembers } };
vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

  // A TEE node is admitted to the namespace and its folders as a member row;
  // it is infrastructure, so no member list may show it as a person.
  it('keeps TEE nodes out of `members` and reports them as `teeMembers`', async () => {
    const person = { identity: 'a'.repeat(64), role: 'Admin' };
    const replica = { identity: 'c'.repeat(64), role: 'ReadOnlyTee' };
    const relay = { identity: 'd'.repeat(64), role: 'RelayTee' };
    listGroupMembers.mockResolvedValue({ members: [person, replica, relay] });
    const { result } = renderHook(() => useFolderMembership('folder-tee'));
    await waitFor(() => expect(result.current.readFor).toBe('folder-tee'));
    expect(result.current.members).toEqual([person]);
    expect(result.current.teeMembers).toEqual([replica, relay]);
  });

  it('reports the failure and keeps the previous read', async () => {
    listGroupMembers.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useFolderMembership('folder-2'));
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.readFor).toBeNull();
  });
});
