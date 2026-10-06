import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
// vi.mock is hoisted above imports, so this import still resolves to
// the mocked '@calimero-network/mero-react' below.
import { HTTPError } from '@calimero-network/mero-js';
import { useFolderOperations } from '../useFolderOperations';
import { CAPABILITIES } from '@/constants/config';

// Capture the mero-react mutation mocks so assertions can read call args.
const createGroupInNamespace = vi.fn();
const setSubgroupVisibility = vi.fn();
const setGroupMetadata = vi.fn();
const createContext = vi.fn();
const deleteContext = vi.fn();
const deleteGroup = vi.fn();
const addGroupMembers = vi.fn();
const listGroupMembers = vi.fn();
const updateMemberRole = vi.fn();
const setMemberCapabilities = vi.fn();
const reparentGroup = vi.fn();
const getGroupInfo = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useCreateGroupInNamespace: () => ({ createGroupInNamespace }),
  useCreateContext: () => ({ createContext }),
  useDeleteContext: () => ({ deleteContext }),
  useDeleteGroup: () => ({ deleteGroup }),
  useSetSubgroupVisibility: () => ({ setSubgroupVisibility }),
  // setGroupMetadata / addGroupMembers go through the raw admin client,
  // so they're mocked on `mero.admin` rather than their own `use*` export.
  useMero: () => ({
    nodeUrl: 'http://node',
    mero: {},
    // The session-aware admin (`useMero().admin`) is what the code writes through.
    admin: {
      setGroupMetadata,
      addGroupMembers,
      listGroupMembers,
      updateMemberRole,
      setMemberCapabilities,
      // Reparenting goes through the session-aware admin too, no raw
      // `fetch` to `/admin-api/groups/:id/reparent` any more.
      reparentGroup,
      getGroupInfo,
      getMemberCapabilities: async () => ({ capabilities: 0 }),
    },
  }),
}));

const ROOT = 'root-group';

beforeEach(() => {
  vi.clearAllMocks();
  createGroupInNamespace.mockResolvedValue({ groupId: 'new-folder' });
  setSubgroupVisibility.mockResolvedValue(undefined);
  setGroupMetadata.mockResolvedValue(undefined);
  createContext.mockResolvedValue({ contextId: 'docs-ctx' });
  addGroupMembers.mockResolvedValue(undefined);
  listGroupMembers.mockResolvedValue({ members: [] });
  setMemberCapabilities.mockResolvedValue(undefined);
  reparentGroup.mockResolvedValue({ reparented: true });
  getGroupInfo.mockResolvedValue({ metadata: { name: 'Old', data: {} } });
});

describe('useFolderOperations.create - reparenting', () => {
  it('reparents a sub-folder through the admin client, before it is named', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: 'parent-folder',
      alias: 'Nested',
      visibility: 'Restricted',
    });
    expect(reparentGroup).toHaveBeenCalledWith('new-folder', { newParentId: 'parent-folder' });
    // The name op must encrypt on the chain the folder ends up on, so the
    // reparent lands first.
    expect(reparentGroup.mock.invocationCallOrder[0]).toBeLessThan(
      setGroupMetadata.mock.invocationCallOrder[0],
    );
  });

  it('does not reparent a folder created directly under the root', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Top level',
      visibility: 'Restricted',
    });
    expect(reparentGroup).not.toHaveBeenCalled();
  });
});

describe('useFolderOperations.create - Read only', () => {
  it('leaves the members of a new Restricted sub-folder with the role they were added with', async () => {
    const BOB = 'b'.repeat(64);
    listGroupMembers.mockImplementation(async () => ({
      members: [{ identity: BOB, role: 'ReadOnly' }],
    }));
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: 'parent-folder',
      alias: 'Private',
      visibility: 'Restricted',
      members: [BOB],
    });
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  // Read only on a folder covers the sub-folders made later, too.
  it("makes the parent's Read only members Read only in a new sub-folder", async () => {
    const BOB = 'b'.repeat(64);
    listGroupMembers.mockImplementation(async () => ({
      // An Open folder lists an inheritor with the parent row's role.
      members: [{ identity: BOB, role: 'ReadOnly' }],
    }));
    updateMemberRole.mockRejectedValue(
      new HTTPError(404, '', '/groups/new-folder', new Headers()),
    );
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: 'parent-folder',
      alias: 'Notes',
      visibility: 'Open',
    });
    expect(addGroupMembers).toHaveBeenCalledWith('new-folder', {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
    // Written while the folder is still Restricted, so it is never Open without them.
    expect(addGroupMembers.mock.invocationCallOrder[0]).toBeLessThan(
      setSubgroupVisibility.mock.invocationCallOrder[0],
    );
    expect(setMemberCapabilities).toHaveBeenCalledWith('new-folder', BOB, {
      capabilities: CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS,
    });
  });
});

describe('useFolderOperations.create - visibility', () => {
  it('creates a top-level Open folder Open, with no visibility flip', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Open one',
      visibility: 'Open',
    });
    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { visibility: 'open' });
    expect(setSubgroupVisibility).not.toHaveBeenCalled();
    expect(setGroupMetadata).toHaveBeenCalledWith('new-folder', { name: 'Open one', data: {} });
  });

  it('still flips a nested Open folder after reparenting it', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: 'parent-folder',
      alias: 'Nested',
      visibility: 'Open',
    });
    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { visibility: 'restricted' });
    expect(setSubgroupVisibility).toHaveBeenCalledWith('new-folder', { subgroupVisibility: 'open' });
    expect(reparentGroup.mock.invocationCallOrder[0]).toBeLessThan(
      setSubgroupVisibility.mock.invocationCallOrder[0],
    );
  });
});

describe('useFolderOperations.create - visibility', () => {
  it('creates a top-level Open folder Open, with no visibility flip', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(makeRegistry(), ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Open one',
      visibility: 'Open',
    });
    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { visibility: 'open' });
    expect(setSubgroupVisibility).not.toHaveBeenCalled();
    expect(setGroupMetadata).toHaveBeenCalledWith('new-folder', { name: 'Open one' });
  });

  it('still flips a nested Open folder after reparenting it', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(makeRegistry(), ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: 'parent-folder',
      alias: 'Nested',
      visibility: 'Open',
    });
    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { visibility: 'restricted' });
    expect(setSubgroupVisibility).toHaveBeenCalledWith('new-folder', { subgroupVisibility: 'open' });
    expect(reparentGroup.mock.invocationCallOrder[0]).toBeLessThan(
      setSubgroupVisibility.mock.invocationCallOrder[0],
    );
  });
});

describe('useFolderOperations.create - members', () => {
  it('adds each chosen member (core role "Member") once the folder exists', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );

    const outcome = await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a', 'member-b'],
    });
    expect(outcome).toEqual([]);

    // Role MUST be the PascalCase core MemberRole variant - lowercase
    // 'member' is rejected by the server with a deserialize 400.
    expect(addGroupMembers).toHaveBeenCalledWith('new-folder', {
      members: [
        { identity: 'member-a', role: 'Member' },
        { identity: 'member-b', role: 'Member' },
      ],
    });
    // Ordering: members are added after the docs context exists and
    // before the post-create refetch (so the refreshed list already
    // reflects the new membership).
    expect(createContext.mock.invocationCallOrder[0]).toBeLessThan(
      addGroupMembers.mock.invocationCallOrder[0],
    );
    expect(addGroupMembers.mock.invocationCallOrder[0]).toBeLessThan(
      refetch.mock.invocationCallOrder[0],
    );
  });

  // Sealed with the folder: a Restricted folder's under its own key.
  it("writes the name and colour into the folder's own metadata", async () => {
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Finance',
      visibility: 'Restricted',
      color: '#ff0000',
    });
    expect(setGroupMetadata).toHaveBeenCalledWith('new-folder', {
      name: 'Finance',
      data: { color: '#ff0000' },
    });
  });

  it('does not call addGroupMembers when no members are given', async () => {
    const { result } = renderHook(() =>
      useFolderOperations(
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

  it('member-add failure is logged but does NOT throw or roll back (so the dialog closes, no duplicate folder)', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    addGroupMembers.mockRejectedValue(new Error('add boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );

    // create RESOLVES with the folder id even though the member-add
    // failed - it must not throw, or NewFolderDialog would stay open
    // with Create re-enabled and the user could create a duplicate.
    const outcome = await result.current.create({
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Secret',
      visibility: 'Restricted',
      members: ['member-a'],
    });
    // The caller (NewFolderDialog) needs to know which adds failed so
    // it can tell the user, instead of only logging it.
    expect(outcome).toEqual(['member-a']);

    // Folder stays put (no rollback), rail is refreshed, and the failure
    // is surfaced loudly to the console rather than silently swallowed.
    expect(deleteContext).not.toHaveBeenCalled();
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('useFolderOperations.create - double-submit guard', () => {
  it('ignores a second create() call while the first is still in flight', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    let resolveGroup!: (v: { groupId: string }) => void;
    createGroupInNamespace.mockReturnValueOnce(
      new Promise((r) => {
        resolveGroup = r;
      }),
    );
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );

    const input = {
      namespaceId: 'ns-1',
      parentGroupId: ROOT,
      alias: 'Docs',
      visibility: 'Open' as const,
    };
    const p1 = result.current.create(input);
    const p2 = result.current.create(input);

    expect(createGroupInNamespace).toHaveBeenCalledTimes(1);
    resolveGroup({ groupId: 'new-folder' });
    await Promise.all([p1, p2]);

    expect(createGroupInNamespace).toHaveBeenCalledTimes(1);
  });
});

describe('useFolderOperations.rename', () => {
  it('rejects when the admin call fails, carrying the server message', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    setGroupMetadata.mockRejectedValue(new Error('HTTP 500: group not found'));
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );

    await expect(result.current.rename('f1', 'New name')).rejects.toThrow(
      'HTTP 500: group not found',
    );
    // A rejected rename must not refresh the (unchanged) folder list.
    expect(refetch).not.toHaveBeenCalled();
  });

  it('resolves and refreshes the folder list on success', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );

    await expect(result.current.rename('f1', 'New name')).resolves.toBeUndefined();
    expect(setGroupMetadata).toHaveBeenCalledWith('f1', { name: 'New name', data: {} });
    expect(refetch).toHaveBeenCalled();
  });

  // A metadata write replaces the whole record.
  it('keeps the folder colour across a rename', async () => {
    getGroupInfo.mockResolvedValue({ metadata: { name: 'Old', data: { color: '#00ff00' } } });
    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', vi.fn().mockResolvedValue(undefined)),
    );
    await result.current.rename('f1', 'New name');
    expect(setGroupMetadata).toHaveBeenCalledWith('f1', {
      name: 'New name',
      data: { color: '#00ff00' },
    });
  });
});

describe('useFolderOperations.remove', () => {
  // Core's cascade takes the subtree, Restricted folders this caller cannot see included.
  it('deletes the folder alone and lets core cascade its subtree', async () => {
    deleteGroup.mockResolvedValue(undefined);
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFolderOperations(ROOT, 'app-1', refetch));
    await result.current.remove('f1');
    expect(deleteGroup.mock.calls).toEqual([['f1']]);
    expect(deleteContext).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drift// ---------------------------------------------------------------------------
// Drift: does a failed create leave the three backends disagreeing?
//
// A folder is sequential writes across admin groups and contexts, with no
// transaction spanning them. "Drift" is the state where some of those writes
// survive and others don't.
//
// These tests fail each step in turn and check the surviving artifacts.
// ---------------------------------------------------------------------------

// A real ledger, not a call-count. Counting "the mock was called" is wrong in
// exactly the cases under test: a rejected create writes nothing, and a
// rejected rollback deletes nothing. Only successful calls mutate the ledger.
interface Ledger {
  groups: Set<string>;
  contexts: Set<string>;
}

function wireLedger(failing: string, boom: Error): Ledger {
  const led: Ledger = { groups: new Set(), contexts: new Set() };
  const step = (name: string, ok: () => void) => async () => {
    if (name === failing) throw boom;
    ok();
  };
  createGroupInNamespace.mockImplementation(async () => {
    if (failing === 'createGroupInNamespace') throw boom;
    led.groups.add('new-folder');
    return { groupId: 'new-folder' };
  });
  createContext.mockImplementation(async () => {
    if (failing === 'createContext') throw boom;
    led.contexts.add('docs-ctx');
    return { contextId: 'docs-ctx' };
  });
  setSubgroupVisibility.mockImplementation(step('setSubgroupVisibility', () => {}));
  setGroupMetadata.mockImplementation(step('setGroupMetadata', () => {}));
  // Rollbacks. `failing` never names one here except in the double-failure test,
  // which overrides deleteGroup itself.
  deleteGroup.mockImplementation(async (id: string) => {
    led.groups.delete(id);
  });
  deleteContext.mockImplementation(async (id: string) => {
    led.contexts.delete(id);
  });
  return led;
}

function surviving(led: Ledger) {
  return {
    group: led.groups.size > 0,
    context: led.contexts.size > 0,
  };
}

const CREATE_STEPS = [
  'createGroupInNamespace',
  'setSubgroupVisibility',
  'setGroupMetadata',
  'createContext',
] as const;

describe('useFolderOperations.create - drift on partial failure', () => {
  it.each(CREATE_STEPS)('rolls back cleanly when %s fails', async (step) => {
    const boom = new Error(`${step} boom`);
    const led = wireLedger(step, boom);
    const refetch = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );
    await expect(
      result.current.create({
        namespaceId: 'ns-1',
        alias: 'Docs',
        parentGroupId: ROOT,
        visibility: 'Restricted',
        members: [],
      }),
    ).rejects.toThrow();

    // The invariant: a failed create leaves nothing behind on any backend.
    // Anything surviving here IS drift, and would need Reconcile to repair.
    expect(surviving(led)).toEqual({ group: false, context: false });
  });

  // The mechanism by which drift becomes possible: every rollback call is
  // `.catch()`-ed and logged, so if cleanup ALSO fails the artifact survives
  // and nothing surfaces. This test asserts that reality rather than wishing
  // it away - it is the reproducer for the condition Reconcile repairs.
  it('leaves an orphaned group when the create fails AND its rollback fails', async () => {
    const led = wireLedger('createContext', new Error('context boom'));
    // The rollback for the group also fails, and the code swallows that.
    deleteGroup.mockRejectedValue(new Error('rollback boom'));
    const refetch = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFolderOperations(ROOT, 'app-1', refetch),
    );
    await expect(
      result.current.create({
        namespaceId: 'ns-1',
        alias: 'Docs',
        parentGroupId: ROOT,
        visibility: 'Restricted',
        members: [],
      }),
    ).rejects.toThrow();

    // Drift, demonstrated: the admin group exists and the rollback failure
    // was swallowed.
    expect(deleteGroup).toHaveBeenCalled();
    expect(surviving(led).group).toBe(true);
  });
});
