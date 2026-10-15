import { describe, it, expect } from 'vitest';
import { buildAliasMap, makeAliases, ownerLabel, resolveFromMap } from './useAliases';

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
    expect(resolveFromMap(map, '4f8a2c9e1234c2e14f8a2c9e1234c2e1')).toBe('4f8a…c2e1');
  });

  it('short unaliased keys pass through unchanged (truncateKey no-op)', () => {
    expect(resolveFromMap(new Map(), 'pk-2')).toBe('pk-2');
  });

  it('an unmapped alias-like string (e.g. a foreign assignee) passes through unmangled', () => {
    expect(resolveFromMap(new Map(), 'alexander-dev')).toBe('alexander-dev');
  });

  it('reflects a refreshed map immediately (same contract `refresh()` relies on)', () => {
    let map = buildAliasMap([]);
    expect(resolveFromMap(map, 'pk-1')).toBe('pk-1');
    // Simulates what refresh() does: re-fetch, rebuild the map, swap it in.
    map = buildAliasMap([{ name: 'alice', value: 'pk-1' }]);
    expect(resolveFromMap(map, 'pk-1')).toBe('alice');
  });
});

// Real account ids: the admin API lists members in hex, a contract stamps the
// same account in base58, and a deal stores whichever its writer held.
const HEX = '5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334';
const B58 = '711jRM5BkBNcexvBDoEHuEd2ffTynNCBzRGNjfC4k4eX';
const OTHER = '1111111111111111111111111111111111111111111111111111111111111111';

describe('account spellings', () => {
  it('resolves a base58 id to the name set for the same hex account', () => {
    const aliases = makeAliases(buildAliasMap([{ name: 'Sandi', value: HEX }]), async () => {}, async () => {}, false, true);
    expect(aliases.resolve(B58)).toBe('Sandi');
    expect(aliases.hasAlias(B58)).toBe(true);
    expect(aliases.hasAlias(HEX.toUpperCase())).toBe(true);
  });
});

describe('ownerLabel (deal and activity owners)', () => {
  const map = buildAliasMap([{ name: 'Sandi', value: HEX }]);
  const resolve = (k: string) => resolveFromMap(map, k);

  it('names a stored account at display time', () => {
    expect(ownerLabel(HEX, resolve, [HEX])).toBe('Sandi');
  });

  it('falls back to a short id for an account with no name', () => {
    expect(ownerLabel(OTHER, resolve, [OTHER])).toBe('1111…1111');
  });

  it('resolves an old frozen truncated key back to its member', () => {
    expect(ownerLabel('5926…1334', resolve, [OTHER, HEX])).toBe('Sandi');
  });

  it('shows an old stored name as-is, and nothing for no owner', () => {
    expect(ownerLabel('Ana', resolve, [HEX])).toBe('Ana');
    expect(ownerLabel(null, resolve, [HEX])).toBe('');
  });
});
