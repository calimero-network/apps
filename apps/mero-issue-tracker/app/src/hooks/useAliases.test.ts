import { describe, it, expect } from 'vitest';
import { buildAliasMap, resolveFromMap } from './useAliases';

describe('buildAliasMap', () => {
  it('maps identity value -> alias name', () => {
    const map = buildAliasMap([{ name: 'alice', value: 'pk-1' }, { name: 'bob', value: 'pk-2' }]);
    expect(map.get('pk-1')).toBe('alice');
    expect(map.get('pk-2')).toBe('bob');
  });

  it('is empty for an empty entry list', () => {
    expect(buildAliasMap([]).size).toBe(0);
  });

  it('last entry wins on a duplicate identity (defensive against a dirty alias list)', () => {
    const map = buildAliasMap([{ name: 'old', value: 'pk-1' }, { name: 'new', value: 'pk-1' }]);
    expect(map.get('pk-1')).toBe('new');
  });
});

describe('resolveFromMap (the actual resolve() logic)', () => {
  it('returns the alias when the identity is known', () => {
    const map = buildAliasMap([{ name: 'alice', value: 'pk-1' }]);
    expect(resolveFromMap(map, 'pk-1')).toBe('alice');
  });

  it('falls back to a truncated key when the identity has no alias', () => {
    const map = buildAliasMap([{ name: 'alice', value: 'pk-1' }]);
    expect(resolveFromMap(map, '4f8a2c9e1234c2e1')).toBe('4f8a…c2e1');
  });

  it('short unaliased keys pass through unchanged (truncateKey no-op)', () => {
    expect(resolveFromMap(new Map(), 'pk-2')).toBe('pk-2');
  });

  it('reflects a refreshed map immediately (same contract `refresh()` relies on)', () => {
    let map = buildAliasMap([]);
    expect(resolveFromMap(map, 'pk-1')).toBe('pk-1');
    // Simulates what refresh() does: re-fetch, rebuild the map, swap it in.
    map = buildAliasMap([{ name: 'alice', value: 'pk-1' }]);
    expect(resolveFromMap(map, 'pk-1')).toBe('alice');
  });
});
