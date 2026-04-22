import { describe, it, expect } from 'vitest';
import { deriveOrphanState } from '../useFolderAccess';

describe('deriveOrphanState', () => {
  const registry = [
    { id: 'a', parent_id: null },
    { id: 'b', parent_id: 'a' },
    { id: 'c', parent_id: 'b' },
  ];

  it('not orphan when parent visible in subgroups', () => {
    const subgroupIds = new Set(['a', 'b', 'c']);
    expect(deriveOrphanState(registry, subgroupIds, 'c').isOrphan).toBe(false);
  });

  it('orphan when folder is a direct member but parent is not', () => {
    const subgroupIds = new Set(['c']);
    const s = deriveOrphanState(registry, subgroupIds, 'c');
    expect(s.isOrphan).toBe(true);
    expect(s.ancestorChain).toEqual(['b', 'a']);
  });
});
