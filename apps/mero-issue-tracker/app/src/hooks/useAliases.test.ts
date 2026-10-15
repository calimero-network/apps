import { describe, it, expect } from 'vitest';
import { buildAliasMap, makeAliases, resolveFromMap } from './useAliases';

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

// The admin API lists members in hex; the contract stamps `created_by` and
// comment `author` with the same account in base58. Comparing raw strings
// left every author as a key glyph and `711j…k4eX` beside a named member.
describe('account spellings', () => {
  const HEX = '5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334';
  const B58 = '711jRM5BkBNcexvBDoEHuEd2ffTynNCBzRGNjfC4k4eX';

  it('names a base58-stamped author from the hex member name', () => {
    const map = buildAliasMap([{ name: 'Sandi', value: HEX }]);
    expect(resolveFromMap(map, B58)).toBe('Sandi');
  });

  it('hasAlias matches either spelling, so the avatar uses the name', () => {
    const aliases = makeAliases(buildAliasMap([{ name: 'Sandi', value: HEX }]), async () => {}, async () => {}, false, true);
    expect(aliases.hasAlias(B58)).toBe(true);
    expect(aliases.hasAlias(HEX.toUpperCase())).toBe(true);
    expect(aliases.resolve(B58)).toBe('Sandi');
  });
});
