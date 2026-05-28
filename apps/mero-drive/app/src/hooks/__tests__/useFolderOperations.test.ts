import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
// vi.mock is hoisted above imports, so this import still resolves to
// the mocked '@calimero-network/mero-react' below.
import { useFolderOperations } from '../useFolderOperations';

// Capture the mero-react mutation mocks so assertions can read call args.
const createGroupInNamespace = vi.fn();
const setSubgroupVisibility = vi.fn();
const setGroupMetadata = vi.fn();
const createContext = vi.fn();
const deleteContext = vi.fn();
const deleteGroup = vi.fn();
const addGroupMembers = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useCreateGroupInNamespace: () => ({ createGroupInNamespace }),
  useCreateContext: () => ({ createContext }),
  useDeleteContext: () => ({ deleteContext }),
  useDeleteGroup: () => ({ deleteGroup }),
  useSetGroupMetadata: () => ({ setGroupMetadata }),
  useSetSubgroupVisibility: () => ({ setSubgroupVisibility }),
  useAddGroupMembers: () => ({ addGroupMembers }),
  useMero: () => ({ nodeUrl: 'http://node' }),
}));

function makeRegistry() {
  return {
    registerFolder: vi.fn().mockResolvedValue(undefined),
    bindFolderContext: vi.fn().mockResolvedValue(undefined),
    unregisterFolder: vi.fn().mockResolvedValue(undefined),
    getFolderContext: vi.fn(),
    getFolders: vi.fn().mockResolvedValue([]),
  } as unknown as Parameters<typeof useFolderOperations>[0];
}

const ROOT = 'root-group';

beforeEach(() => {
  vi.clearAllMocks();
  createGroupInNamespace.mockResolvedValue({ groupId: 'new-folder' });
  setSubgroupVisibility.mockResolvedValue(undefined);
  setGroupMetadata.mockResolvedValue(undefined);
  createContext.mockResolvedValue({ contextId: 'docs-ctx' });
  addGroupMembers.mockResolvedValue(undefined);
});

describe('useFolderOperations.create — members', () => {
  it('adds each chosen member (core role "Member") after the folder is bound', async () => {
    const registry = makeRegistry();
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFolderOperations(registry, ROOT, 'app-1', refetch),
    );

    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a', 'member-b'],
    });

    // Role MUST be the PascalCase core MemberRole variant — lowercase
    // 'member' is rejected by the server with a deserialize 400.
    expect(addGroupMembers).toHaveBeenCalledWith('new-folder', {
      members: [
        { identity: 'member-a', role: 'Member' },
        { identity: 'member-b', role: 'Member' },
      ],
    });
    // Ordering: members are added after the context is bound and
    // before the post-create refetch (so the refreshed list already
    // reflects the new membership).
    const bind = registry as unknown as {
      bindFolderContext: { mock: { invocationCallOrder: number[] } };
    };
    expect(bind.bindFolderContext.mock.invocationCallOrder[0]).toBeLessThan(
      addGroupMembers.mock.invocationCallOrder[0],
    );
    expect(addGroupMembers.mock.invocationCallOrder[0]).toBeLessThan(
      refetch.mock.invocationCallOrder[0],
    );
  });

  it('does not call addGroupMembers when no members are given', async () => {
    const registry = makeRegistry();
    const { result } = renderHook(() =>
      useFolderOperations(
        registry,
        ROOT,
        'app-1',
        vi.fn().mockResolvedValue(undefined),
      ),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Open one',
      visibility: 'Open',
    });
    expect(addGroupMembers).not.toHaveBeenCalled();
  });

  it('member-add failure is logged but does NOT throw or roll back (so the dialog closes — no duplicate folder)', async () => {
    const registry = makeRegistry();
    const refetch = vi.fn().mockResolvedValue(undefined);
    addGroupMembers.mockRejectedValue(new Error('add boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useFolderOperations(registry, ROOT, 'app-1', refetch),
    );

    // create RESOLVES with the folder id even though the member-add
    // failed — it must not throw, or NewFolderDialog would stay open
    // with Create re-enabled and the user could create a duplicate.
    const id = await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a'],
    });
    expect(id).toBe('new-folder');

    // Folder stays put (no rollback), rail is refreshed, and the failure
    // is surfaced loudly to the console rather than silently swallowed.
    const reg = registry as unknown as {
      unregisterFolder: ReturnType<typeof vi.fn>;
    };
    expect(reg.unregisterFolder).not.toHaveBeenCalled();
    expect(deleteContext).not.toHaveBeenCalled();
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
