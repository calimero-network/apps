import { describe, it, expect } from 'vitest';
import { mergeAdminAndRegistry } from '../useWorkspaceTree';

describe('mergeAdminAndRegistry', () => {
  // Registry is the source of truth for existence + tree shape; admin
  // side contributes `name` (was `alias` pre-#2338), and the optional
  // visibilityById map (sourced from core's GroupInfo per PR #2261)
  // contributes the subgroup_visibility. The merge iterates registry
  // and enriches each entry from both side channels.
  const admin = [
    { groupId: 'a', parent_id: 'r', name: 'A' },
    { groupId: 'b', parent_id: 'a', name: 'B' },
  ];
  const registry = [
    { id: 'a', parent_id: 'r', color: '#f00' },
    { id: 'b', parent_id: 'a', color: null },
  ];
  const visibility = new Map<string, 'Open' | 'Restricted'>([
    ['a', 'Open'],
    ['b', 'Restricted'],
  ]);

  it('merges admin aliases and core-sourced visibility onto registry folders', () => {
    const tree = mergeAdminAndRegistry(admin, registry, 'r', visibility);
    expect(tree.folders.find((f) => f.id === 'a')?.color).toBe('#f00');
    expect(tree.folders.find((f) => f.id === 'b')?.visibility).toBe('Restricted');
    expect(tree.folders.find((f) => f.id === 'a')?.visibility).toBe('Open');
    expect(tree.folders.find((f) => f.id === 'a')?.alias).toBe('A');
  });

  it('excludes the root group from the folder list', () => {
    const registryWithRoot = [
      { id: 'r', parent_id: null, color: null },
      ...registry,
    ];
    const tree = mergeAdminAndRegistry(admin, registryWithRoot, 'r', visibility);
    expect(tree.folders.find((f) => f.id === 'r')).toBeUndefined();
  });

  it('still renders folders when admin is empty — falls back to a stub alias and undefined visibility', () => {
    // This protects against the upstream listSubgroups bug (mero-js
    // unwraps `.data` from a `{subgroups}` response — folder list
    // comes back empty). Registry is authoritative, so folders must
    // still appear. visibilityById omitted so we exercise the
    // "loading" path (undefined per-folder).
    const tree = mergeAdminAndRegistry([], registry, 'r');
    const a = tree.folders.find((f) => f.id === 'a');
    expect(a?.visibility).toBeUndefined();
    expect(a?.color).toBe('#f00');
    expect(a?.alias).toMatch(/^folder-/);
  });
});

describe('mergeAdminAndRegistry hiddenIds', () => {
  const root = 'root-group';
  const reg = [
    { id: 'f-open', parent_id: null, color: null },
    { id: 'f-secret', parent_id: null, color: null },
  ];

  it('excludes folders whose id is in hiddenIds', () => {
    const { folders } = mergeAdminAndRegistry(
      [],
      reg,
      root,
      new Map([
        ['f-open', 'Open'],
        ['f-secret', 'Restricted'],
      ]),
      new Set(['f-secret']),
    );
    expect(folders.map((f) => f.id)).toEqual(['f-open']);
  });

  it('keeps every folder when hiddenIds is undefined (back-compat)', () => {
    const { folders } = mergeAdminAndRegistry([], reg, root);
    expect(folders.map((f) => f.id).sort()).toEqual(['f-open', 'f-secret']);
  });

  it('keeps every folder when hiddenIds is empty', () => {
    const { folders } = mergeAdminAndRegistry([], reg, root, undefined, new Set());
    expect(folders.map((f) => f.id).sort()).toEqual(['f-open', 'f-secret']);
  });
});
