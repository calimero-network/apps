import { describe, it, expect } from 'vitest';
import { mergeAdminAndRegistry } from '../useWorkspaceTree';

describe('mergeAdminAndRegistry', () => {
  // Registry is the source of truth for existence + tree shape; admin
  // side contributes only `alias`. The merge iterates registry and
  // enriches each entry with the alias from admin when present.
  const admin = [
    { groupId: 'a', parent_id: 'r', alias: 'A' },
    { groupId: 'b', parent_id: 'a', alias: 'B' },
  ];
  const registry = [
    { id: 'a', parent_id: 'r', visibility: 'Inherit' as const, color: '#f00' },
    { id: 'b', parent_id: 'a', visibility: 'Restricted' as const, color: null },
  ];

  it('merges admin aliases onto registry folders', () => {
    const tree = mergeAdminAndRegistry(admin, registry, 'r');
    expect(tree.folders.find((f) => f.id === 'a')?.color).toBe('#f00');
    expect(tree.folders.find((f) => f.id === 'b')?.visibility).toBe('Restricted');
    expect(tree.folders.find((f) => f.id === 'a')?.alias).toBe('A');
  });

  it('excludes the root group from the folder list', () => {
    const registryWithRoot = [
      { id: 'r', parent_id: null, visibility: 'Inherit' as const, color: null },
      ...registry,
    ];
    const tree = mergeAdminAndRegistry(admin, registryWithRoot, 'r');
    expect(tree.folders.find((f) => f.id === 'r')).toBeUndefined();
  });

  it('still renders folders when admin is empty — falls back to a stub alias', () => {
    // This protects against the upstream listSubgroups bug (mero-js
    // unwraps `.data` from a `{subgroups}` response — folder list
    // comes back empty). Registry is authoritative, so folders must
    // still appear.
    const tree = mergeAdminAndRegistry([], registry, 'r');
    const a = tree.folders.find((f) => f.id === 'a');
    expect(a?.visibility).toBe('Inherit');
    expect(a?.color).toBe('#f00');
    expect(a?.alias).toMatch(/^folder-/);
  });
});
