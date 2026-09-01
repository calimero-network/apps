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

// ---------------------------------------------------------------------------
// Drift: does a failed create leave the three backends disagreeing?
//
// A folder is 7 sequential writes across admin groups, contexts and the
// registry WASM, with no transaction spanning them. "Drift" is the state where
// some of those writes survive and others don't, which is what the Reconcile
// button exists to repair. Nothing has ever demonstrated it: the merobox
// `reconciliation` workflow manufactures drift by deliberately doing half a
// write, so it proves the registry can service repair calls, not that the app
// ever produces the condition.
//
// These tests fail each step in turn and check the surviving artifacts.
// ---------------------------------------------------------------------------

// A real ledger, not a call-count. Counting "the mock was called" is wrong in
// exactly the cases under test: a rejected create writes nothing, and a
// rejected rollback deletes nothing. Only successful calls mutate the ledger.
interface Ledger {
  groups: Set<string>;
  contexts: Set<string>;
  registry: Set<string>;
}

function wireLedger(
  registry: {
    registerFolder: ReturnType<typeof vi.fn>;
    unregisterFolder: ReturnType<typeof vi.fn>;
  },
  failing: string,
  boom: Error,
): Ledger {
  const led: Ledger = { groups: new Set(), contexts: new Set(), registry: new Set() };
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
  registry.registerFolder.mockImplementation(
    step('registerFolder', () => led.registry.add('new-folder')),
  );
  (registry as unknown as { bindFolderContext: ReturnType<typeof vi.fn> })
    .bindFolderContext.mockImplementation(step('bindFolderContext', () => {}));
  // Rollbacks. `failing` never names one here except in the double-failure test,
  // which overrides deleteGroup itself.
  deleteGroup.mockImplementation(async (id: string) => {
    led.groups.delete(id);
  });
  deleteContext.mockImplementation(async (id: string) => {
    led.contexts.delete(id);
  });
  registry.unregisterFolder.mockImplementation(async ({ id }: { id: string }) => {
    led.registry.delete(id);
  });
  return led;
}

function surviving(led: Ledger) {
  return {
    group: led.groups.size > 0,
    context: led.contexts.size > 0,
    registry: led.registry.size > 0,
  };
}

const CREATE_STEPS = [
  'createGroupInNamespace',
  'setSubgroupVisibility',
  'setGroupMetadata',
  'createContext',
  'registerFolder',
  'bindFolderContext',
] as const;

describe('useFolderOperations.create — drift on partial failure', () => {
  it.each(CREATE_STEPS)('rolls back cleanly when %s fails', async (step) => {
    const registry = makeRegistry() as unknown as {
      registerFolder: ReturnType<typeof vi.fn>;
      bindFolderContext: ReturnType<typeof vi.fn>;
      unregisterFolder: ReturnType<typeof vi.fn>;
    };
    const boom = new Error(`${step} boom`);
    const led = wireLedger(registry, step, boom);

    const { result } = renderHook(() =>
      useFolderOperations(registry as never, ROOT, 'app-1'),
    );
    await expect(
      result.current.create({
        namespaceId: 'ns-1',
        alias: 'Docs',
        parentGroupId: null,
        visibility: 'Restricted',
        members: [],
      }),
    ).rejects.toThrow();

    // The invariant: a failed create leaves nothing behind on any backend.
    // Anything surviving here IS drift, and would need Reconcile to repair.
    expect(surviving(led)).toEqual({
      group: false,
      context: false,
      registry: false,
    });
  });

  // The mechanism by which drift becomes possible: every rollback call is
  // `.catch()`-ed and logged, so if cleanup ALSO fails the artifact survives
  // and nothing surfaces. This test asserts that reality rather than wishing
  // it away — it is the reproducer for the condition Reconcile repairs.
  it('leaves an orphaned group when the create fails AND its rollback fails', async () => {
    const registry = makeRegistry() as unknown as {
      registerFolder: ReturnType<typeof vi.fn>;
      unregisterFolder: ReturnType<typeof vi.fn>;
    };
    const led = wireLedger(registry, 'createContext', new Error('context boom'));
    // The rollback for the group also fails, and the code swallows that.
    deleteGroup.mockRejectedValue(new Error('rollback boom'));

    const { result } = renderHook(() =>
      useFolderOperations(registry as never, ROOT, 'app-1'),
    );
    await expect(
      result.current.create({
        namespaceId: 'ns-1',
        alias: 'Docs',
        parentGroupId: null,
        visibility: 'Restricted',
        members: [],
      }),
    ).rejects.toThrow();

    // Drift, demonstrated: the admin group exists, the registry knows nothing
    // about it, and the rollback failure was swallowed.
    expect(deleteGroup).toHaveBeenCalled();
    expect(surviving(led).group).toBe(true);
    expect(surviving(led).registry).toBe(false);
  });
});
