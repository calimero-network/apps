import { describe, expect, it } from 'vitest';
import {
  listIsPackageAware,
  pickApplicationId,
  type InstalledApp,
} from '../appId';
import { PACKAGE_NAME } from '@/constants/config';

const MINE = PACKAGE_NAME;
const THEIRS = 'com.calimero.mero-design';

describe('pickApplicationId', () => {
  it('picks the install whose package is this app', () => {
    const apps: InstalledApp[] = [
      { id: 'other', package: THEIRS, version: '9.9.9' },
      { id: 'mine', package: MINE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('mine');
  });

  // The whole point. `apps[0]` is whichever app the node lists first, and
  // taking it is how mero-drive would end up listing another app's namespaces
  // on a shared origin — filtering correctly, for the wrong app.
  it('returns "" rather than guessing when this app is not installed', () => {
    const apps: InstalledApp[] = [
      { id: 'other', package: THEIRS, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('');
  });

  it('returns "" for an empty list', () => {
    expect(pickApplicationId([])).toBe('');
  });

  // An ApplicationId is `hash(package, signer)`, so a registry build and a
  // locally dev-signed build of the SAME package have different ids and both
  // show up here. Newest wins so a fresh publish beats a stale sideload.
  it('prefers the highest version when several installs share the package', () => {
    const apps: InstalledApp[] = [
      { id: 'old', package: MINE, version: '1.9.0' },
      { id: 'new', package: MINE, version: '1.10.0' },
      { id: 'older', package: MINE, version: '1.2.0' },
    ];
    expect(pickApplicationId(apps)).toBe('new');
  });

  it('compares versions numerically, not lexically', () => {
    const apps: InstalledApp[] = [
      { id: 'nine', package: MINE, version: '0.9.0' },
      { id: 'ten', package: MINE, version: '0.10.0' },
    ];
    expect(pickApplicationId(apps)).toBe('ten');
  });

  it('sorts an unparseable or missing version lowest', () => {
    const apps: InstalledApp[] = [
      { id: 'junk', package: MINE, version: 'nightly' },
      { id: 'real', package: MINE, version: '0.0.1' },
    ];
    expect(pickApplicationId(apps)).toBe('real');
  });

  it('ignores a row with a matching package but no id', () => {
    const apps: InstalledApp[] = [
      { id: '', package: MINE, version: '2.0.0' },
      { id: 'real', package: MINE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('real');
  });
});

describe('listIsPackageAware', () => {
  // A raw-`.wasm` install (what the dev scripts do) has no package, so a
  // no-match against such a list means "cannot tell", not "not installed" —
  // and the caller must keep its fallback rather than claim the app is absent.
  it('is false when no row carries a package', () => {
    expect(
      listIsPackageAware([{ id: 'a' }, { id: 'b', version: '1.0.0' }]),
    ).toBe(false);
  });

  it('is false for an empty package string', () => {
    expect(listIsPackageAware([{ id: 'a', package: '' }])).toBe(false);
  });

  it('is true as soon as any row names a package', () => {
    expect(
      listIsPackageAware([{ id: 'a' }, { id: 'b', package: THEIRS }]),
    ).toBe(true);
  });
});
