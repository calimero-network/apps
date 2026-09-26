import { describe, it, expect } from 'vitest';
import { buildTree, ancestorsOf, descendantsOf, depthOf } from '../ancestry';

const folders = [
  { id: 'a', parent_id: null },
  { id: 'b', parent_id: 'a' },
  { id: 'c', parent_id: 'b' },
  { id: 'd', parent_id: null },
];

describe('ancestry', () => {
  it('builds a tree from flat list', () => {
    const tree = buildTree(folders);
    expect(tree.roots.map((n) => n.id).sort()).toEqual(['a', 'd']);
    expect(tree.byId.get('b')?.children[0]?.id).toBe('c');
  });

  it('ancestorsOf walks root-ward', () => {
    expect(ancestorsOf(folders, 'c')).toEqual(['b', 'a']);
  });

  it('descendantsOf walks leaf-first', () => {
    expect(descendantsOf(folders, 'a')).toEqual(['c', 'b']);
  });

  it('depthOf counts correctly', () => {
    expect(depthOf(folders, 'a')).toBe(0);
    expect(depthOf(folders, 'c')).toBe(2);
  });

  it('detects cycles and returns [] rather than looping', () => {
    const cyc = [
      { id: 'x', parent_id: 'y' },
      { id: 'y', parent_id: 'x' },
    ];
    expect(ancestorsOf(cyc, 'x')).toEqual([]);
  });

  it('descendantsOf survives cycles without stack overflow', () => {
    const cyc = [
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ];
    const res = descendantsOf(cyc, 'a');
    expect(res).toEqual(['b']);
  });
});
