import { describe, it, expect } from 'vitest';
import { computeCascadeTargets } from '../useFolderCascade';
import { DEFAULT_CHILD_CAP_MASK } from '../../constants/config';

describe('computeCascadeTargets', () => {
  const folders = [
    { id: 'root', parent_id: null, visibility: 'Inherit' as const },
    { id: 'a', parent_id: 'root', visibility: 'Inherit' as const },
    { id: 'b', parent_id: 'a', visibility: 'Restricted' as const },
    { id: 'c', parent_id: 'b', visibility: 'Inherit' as const }, // behind restricted wall
  ];

  it('cascades through inherit descendants', () => {
    const targets = computeCascadeTargets(folders, 'root', 0x3);
    expect(targets.map((t) => t.folderId).sort()).toEqual(['a']);
    expect(targets[0].capabilities).toBe(0x3 & DEFAULT_CHILD_CAP_MASK);
  });

  it('stops at restricted subtree', () => {
    const targets = computeCascadeTargets(folders, 'root', 0x3f);
    expect(targets.map((t) => t.folderId)).toEqual(['a']);
  });
});
