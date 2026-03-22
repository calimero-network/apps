import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeContextIdForJoin } from '@/api/contextIdJoin';
import { hasJoinedContextOnNode, markJoinedContextOnNode } from './joinedFolderContexts';

describe('joinedFolderContexts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks and detects joined context with canonical id', () => {
    markJoinedContextOnNode('g1', 'ctx-base58');
    expect(hasJoinedContextOnNode('g1', 'ctx-base58')).toBe(true);
  });

  it('matches hex and base58 forms of the same context id', () => {
    const hex =
      '0000000000000000000000000000000000000000000000000000000000000001';
    const b58 = normalizeContextIdForJoin(hex);
    markJoinedContextOnNode('g1', hex);
    expect(hasJoinedContextOnNode('g1', b58)).toBe(true);
  });
});
