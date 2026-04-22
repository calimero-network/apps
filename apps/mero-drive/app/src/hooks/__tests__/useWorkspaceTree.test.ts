import { describe, it, expect } from 'vitest';
import { mergeAdminAndRegistry } from '../useWorkspaceTree';

describe('mergeAdminAndRegistry', () => {
  // Admin-API subgroup entries use `groupId` (per SubgroupEntry in
  // @calimero-network/mero-js); registry folders use `id` (per the
  // generated FolderDto). The merge bridges those two shapes.
  const admin = [
    { groupId: 'a', parent_id: 'r', alias: 'A' },
    { groupId: 'b', parent_id: 'a', alias: 'B' },
  ];
  const registry = [
    { id: 'a', parent_id: 'r', visibility: 'Inherit' as const, color: '#f00' },
    { id: 'b', parent_id: 'a', visibility: 'Restricted' as const, color: null },
  ];

  it('merges registry metadata onto admin groups', () => {
    const tree = mergeAdminAndRegistry(admin, registry, 'r');
    expect(tree.folders.find((f) => f.id === 'a')?.color).toBe('#f00');
    expect(tree.folders.find((f) => f.id === 'b')?.visibility).toBe('Restricted');
    expect(tree.folders.find((f) => f.id === 'a')?.alias).toBe('A');
  });

  it('excludes the root group from the folder list', () => {
    const rootAndBelow = [{ groupId: 'r', parent_id: null, alias: 'root' }, ...admin];
    const tree = mergeAdminAndRegistry(rootAndBelow, registry, 'r');
    expect(tree.folders.find((f) => f.id === 'r')).toBeUndefined();
  });

  it('defaults visibility to Inherit and color to null when registry is missing the row', () => {
    const tree = mergeAdminAndRegistry(admin, [], 'r');
    const a = tree.folders.find((f) => f.id === 'a');
    expect(a?.visibility).toBe('Inherit');
    expect(a?.color).toBeNull();
  });
});
