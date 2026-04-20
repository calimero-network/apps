import { beforeEach, describe, expect, it } from 'vitest';
import {
  isSelfCreatedFolderContext,
  markSelfCreatedFolderContext,
} from './selfCreatedFolderContexts';

describe('selfCreatedFolderContexts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks and detects self-created folder', () => {
    expect(isSelfCreatedFolderContext('g1', 'c1')).toBe(false);
    markSelfCreatedFolderContext('g1', 'c1');
    expect(isSelfCreatedFolderContext('g1', 'c1')).toBe(true);
    expect(isSelfCreatedFolderContext('g1', 'c2')).toBe(false);
  });
});
