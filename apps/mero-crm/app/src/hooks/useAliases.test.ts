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

// One spelling on Calimero 1.0: the org's member list and the contract's
// `createdBy`/`author` (`env::caller()`) name the same account id.
describe('account ids', () => {
  it('names an author from the member name keyed by the same account id', () => {
    const aliases = makeAliases(buildAliasMap([{ name: 'Sandi', value: 'acct-1' }]), async () => {}, async () => {}, false, true);
    expect(aliases.hasAlias('acct-1')).toBe(true);
    expect(aliases.resolve('acct-1')).toBe('Sandi');
    expect(aliases.hasAlias('acct-2')).toBe(false);
  });
});

describe('ownerLabel (deal and activity owners)', () => {
  const ACCT = '5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334';
  const OTHER = '1111111111111111111111111111111111111111111111111111111111111111';
  const map = buildAliasMap([{ name: 'Sandi', value: ACCT }]);
  const resolve = (k: string) => resolveFromMap(map, k);

  it('names a stored account at display time', () => {
    expect(ownerLabel(ACCT, resolve, [ACCT])).toBe('Sandi');
  });

  it('falls back to a short id for a member with no name', () => {
    expect(ownerLabel(OTHER, resolve, [OTHER])).toBe('1111…1111');
  });

  it('resolves a truncated key back to its member', () => {
    expect(ownerLabel('5926…1334', resolve, [OTHER, ACCT])).toBe('Sandi');
  });

  it('shows a free-text owner as-is, and nothing for no owner', () => {
    expect(ownerLabel('Ana', resolve, [ACCT])).toBe('Ana');
    expect(ownerLabel(null, resolve, [ACCT])).toBe('');
  });
});
