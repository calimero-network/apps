import { describe, expect, it } from 'vitest';
import { APP_PACKAGE, pickApplicationId } from './appId';

const OTHER = 'com.calimero.mero-design';

describe('pickApplicationId', () => {
  it('picks this app by package, ignoring everything else on the node', () => {
    // The reported bug: sharing an origin with another app meant inheriting its
    // session and therefore its application id, so the vault list showed
    // mero-design's namespaces. Matching on package makes that impossible.
    expect(
      pickApplicationId([
        { id: 'design', package: OTHER },
        { id: 'pass', package: APP_PACKAGE },
      ]),
    ).toBe('pass');
  });

  it('returns empty when this app is not installed', () => {
    // Emphatically NOT apps[0]. Falling back to whichever app the node lists
    // first is the wrong-app bug with extra steps; "" lets the caller say "not
    // installed", which is true and actionable.
    expect(pickApplicationId([{ id: 'design', package: OTHER }])).toBe('');
    expect(pickApplicationId([])).toBe('');
  });

  it('prefers the highest version when one package has several installs', () => {
    // A registry build and a locally dev-signed build have DIFFERENT ids — the
    // id is hash(package, signer) — so both can be installed at once.
    expect(
      pickApplicationId([
        { id: 'old', package: APP_PACKAGE, version: '0.0.8' },
        { id: 'new', package: APP_PACKAGE, version: '0.0.10' },
      ]),
    ).toBe('new');
  });

  it('compares versions numerically, not as strings', () => {
    // "0.0.9" > "0.0.10" lexicographically, which would pin the older build.
    expect(
      pickApplicationId([
        { id: 'nine', package: APP_PACKAGE, version: '0.0.9' },
        { id: 'ten', package: APP_PACKAGE, version: '0.0.10' },
      ]),
    ).toBe('ten');
  });

  it('keeps a versioned install over one with no version', () => {
    expect(
      pickApplicationId([
        { id: 'bare', package: APP_PACKAGE },
        { id: 'versioned', package: APP_PACKAGE, version: '0.0.1' },
      ]),
    ).toBe('versioned');
  });

  it('ignores rows with no id', () => {
    expect(
      pickApplicationId([
        { id: '', package: APP_PACKAGE, version: '9.9.9' },
        { id: 'real', package: APP_PACKAGE, version: '0.0.1' },
      ]),
    ).toBe('real');
  });

  it('is stable across reads when versions tie', () => {
    const apps = [
      { id: 'first', package: APP_PACKAGE, version: '1.0.0' },
      { id: 'second', package: APP_PACKAGE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('first');
    expect(pickApplicationId(apps)).toBe('first');
  });
});
