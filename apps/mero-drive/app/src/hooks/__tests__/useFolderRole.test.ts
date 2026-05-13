import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFolderRole, useFolderRoles } from '../useFolderRole';

// useFolderRole reads/writes via useDriveWorkspace().registryClient.
// We mock useDriveWorkspace to hand it a fake client whose methods are
// vi.fn()s the tests drive directly.
const getFolderRoleMock = vi.fn();
const setFolderRoleMock = vi.fn();
const clearFolderRoleMock = vi.fn();
const listFolderRolesMock = vi.fn();

const wsState: { registryClient: unknown; selfIdentity: string | null } = {
  registryClient: {
    getFolderRole: getFolderRoleMock,
    setFolderRole: setFolderRoleMock,
    clearFolderRole: clearFolderRoleMock,
    listFolderRoles: listFolderRolesMock,
  },
  selfIdentity: 'me',
};
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => wsState,
}));

describe('useFolderRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsState.selfIdentity = 'me';
    wsState.registryClient = {
      getFolderRole: getFolderRoleMock,
      setFolderRole: setFolderRoleMock,
      clearFolderRole: clearFolderRoleMock,
      listFolderRoles: listFolderRolesMock,
    };
    getFolderRoleMock.mockResolvedValue('Editor');
    setFolderRoleMock.mockResolvedValue(undefined);
    clearFolderRoleMock.mockResolvedValue(undefined);
    listFolderRolesMock.mockResolvedValue([]);
  });

  it('resolves the role the client returns', async () => {
    getFolderRoleMock.mockResolvedValue('Manager');
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Manager'));
    expect(result.current.loading).toBe(false);
    expect(getFolderRoleMock).toHaveBeenCalledWith({
      folder_id: 'f1',
      member: 'me',
    });
  });

  it('treats an absent (undefined/null) role as Editor', async () => {
    getFolderRoleMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Editor'));
  });

  it('null folderId → role null, loading false-ish (no client call)', async () => {
    const { result } = renderHook(() => useFolderRole(null));
    expect(result.current.role).toBeNull();
    expect(getFolderRoleMock).not.toHaveBeenCalled();
  });

  it('setRole calls the client and refetches', async () => {
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Editor'));
    getFolderRoleMock.mockResolvedValue('Viewer');
    await act(async () => {
      await result.current.setRole('Viewer', 'someone');
    });
    expect(setFolderRoleMock).toHaveBeenCalledWith({
      folder_id: 'f1',
      member: 'someone',
      role: 'Viewer',
    });
    // refetch picked up the new value (for the *self* read, which now
    // returns Viewer in this stubbed client).
    await waitFor(() => expect(result.current.role).toBe('Viewer'));
  });

  it('clearRole defaults the member to the current identity', async () => {
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Editor'));
    await act(async () => {
      await result.current.clearRole();
    });
    expect(clearFolderRoleMock).toHaveBeenCalledWith({
      folder_id: 'f1',
      member: 'me',
    });
  });

  it('surfaces a getFolderRole error', async () => {
    const boom = new Error('rpc down');
    getFolderRoleMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.loading).toBe(false);
  });

  it('refetch() does NOT flip role back to null while the new fetch is pending', async () => {
    // First resolution: Editor.
    getFolderRoleMock.mockResolvedValue('Editor');
    const { result } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Editor'));

    // Set up the next fetch to be slow (pending) — we want to observe
    // the in-flight state directly. Then trigger a refetch.
    let resolveNext: (v: 'Viewer') => void = () => {};
    getFolderRoleMock.mockImplementation(
      () =>
        new Promise<'Viewer'>((r) => {
          resolveNext = r;
        }),
    );
    act(() => {
      result.current.refetch();
    });

    // While the new fetch is in flight, the *previous* role value
    // remains visible — this is the flicker-prevention contract.
    // `loading` is true; `role` is not null.
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.role).toBe('Editor');

    // Resolve the second fetch → role flips to Viewer, loading clears.
    await act(async () => {
      resolveNext('Viewer');
    });
    await waitFor(() => expect(result.current.role).toBe('Viewer'));
    expect(result.current.loading).toBe(false);
  });

  it('changing folderId DOES clear role to null while the new fetch is pending', async () => {
    getFolderRoleMock.mockResolvedValue('Editor');
    const { result, rerender } = renderHook(({ id }) => useFolderRole(id), {
      initialProps: { id: 'f1' },
    });
    await waitFor(() => expect(result.current.role).toBe('Editor'));

    let resolveNext: (v: 'Manager') => void = () => {};
    getFolderRoleMock.mockImplementation(
      () =>
        new Promise<'Manager'>((r) => {
          resolveNext = r;
        }),
    );
    rerender({ id: 'f2' });
    // Genuinely different folder → role must be null, not the stale
    // 'Editor' from f1. Loading is true.
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.role).toBeNull();
    await act(async () => {
      resolveNext('Manager');
    });
    await waitFor(() => expect(result.current.role).toBe('Manager'));
  });

  it('returns stable refetch / setRole / clearRole references across renders', async () => {
    getFolderRoleMock.mockResolvedValue('Editor');
    const { result, rerender } = renderHook(() => useFolderRole('f1'));
    await waitFor(() => expect(result.current.role).toBe('Editor'));
    const firstRefetch = result.current.refetch;
    const firstSetRole = result.current.setRole;
    const firstClearRole = result.current.clearRole;
    rerender();
    expect(result.current.refetch).toBe(firstRefetch);
    expect(result.current.setRole).toBe(firstSetRole);
    expect(result.current.clearRole).toBe(firstClearRole);
  });
});

describe('useFolderRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsState.registryClient = {
      getFolderRole: getFolderRoleMock,
      setFolderRole: setFolderRoleMock,
      clearFolderRole: clearFolderRoleMock,
      listFolderRoles: listFolderRolesMock,
    };
    listFolderRolesMock.mockResolvedValue([
      { member: 'a', role: 'Viewer' },
      { member: 'b', role: 'Manager' },
    ]);
  });

  it('lists the explicit role rows for the folder', async () => {
    const { result } = renderHook(() => useFolderRoles('f1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([
      { member: 'a', role: 'Viewer' },
      { member: 'b', role: 'Manager' },
    ]);
    expect(listFolderRolesMock).toHaveBeenCalledWith({ folder_id: 'f1' });
  });
});
