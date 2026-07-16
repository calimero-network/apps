import { describe, it, expect } from 'vitest';
import { buildAliasMap } from './useAliases';

describe('buildAliasMap', () => {
  it('maps identity value -> alias name', () => {
    const map = buildAliasMap([{ name: 'alice', value: 'pk-1' }, { name: 'bob', value: 'pk-2' }]);
    expect(map.get('pk-1')).toBe('alice');
    expect(map.get('pk-2')).toBe('bob');
  });

  it('is empty for an empty entry list', () => {
    expect(buildAliasMap([]).size).toBe(0);
  });

  it('resolve-style lookup falls back to a truncated key when absent', () => {
    const map = buildAliasMap([{ name: 'alice', value: 'pk-1' }]);
    const longKey = '4f8a2c9e1234c2e1';
    const resolve = (pk: string) => map.get(pk) ?? `${pk.slice(0, 4)}…${pk.slice(-4)}`;
    expect(resolve('pk-1')).toBe('alice');
    expect(resolve(longKey)).toBe('4f8a…c2e1');
  });

  it('last entry wins on a duplicate identity (defensive against a dirty alias list)', () => {
    const map = buildAliasMap([{ name: 'old', value: 'pk-1' }, { name: 'new', value: 'pk-1' }]);
    expect(map.get('pk-1')).toBe('new');
  });
});
