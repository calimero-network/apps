import { describe, expect, it } from 'vitest';
import { pickApplicationId } from './appId';
import { APP_PACKAGE } from '../config';

const MINE = APP_PACKAGE;
const THEIRS = 'com.calimero.mero-design';

describe('pickApplicationId', () => {
  it('matches on the bundle package, not on position', () => {
    expect(
      pickApplicationId([
        { id: 'other', package: THEIRS, version: '9.9.9' },
        { id: 'mine', package: MINE, version: '1.0.0' },
      ]),
    ).toBe('mine');
  });

  it('returns "" when this app is not installed, rather than guessing', () => {
    // `apps[0]` is the obvious fallback and is exactly the wrong-app bug: every
    // namespace read is scoped by the id, so guessing lists another app's
    // workspaces while looking like the filter is being ignored.
    expect(pickApplicationId([{ id: 'other', package: THEIRS }])).toBe('');
    expect(pickApplicationId([])).toBe('');
  });

  it('ignores a row with no package (a bootstrap stub) and one with no id', () => {
    expect(
      pickApplicationId([
        { id: 'stub' },
        { id: '', package: MINE },
        { id: 'mine', package: MINE },
      ]),
    ).toBe('mine');
  });

  it('prefers the highest version when one package has several installs', () => {
    // A registry build and a locally dev-signed one have DIFFERENT ids, because
    // the id is hash(package, signer). A freshly published bundle should win.
    expect(
      pickApplicationId([
        { id: 'old', package: MINE, version: '1.2.9' },
        { id: 'new', package: MINE, version: '1.10.0' },
        { id: 'older', package: MINE, version: '0.9.0' },
      ]),
    ).toBe('new');
  });

  it('sorts an absent or unparseable version lowest', () => {
    expect(
      pickApplicationId([
        { id: 'nover', package: MINE },
        { id: 'semver', package: MINE, version: '0.0.1' },
      ]),
    ).toBe('semver');
  });

  it('keeps the node’s own order when versions are equal', () => {
    // Stability matters: a pick that swaps between reads moves the workspace
    // picker under the user.
    const apps = [
      { id: 'first', package: MINE, version: '1.0.0' },
      { id: 'second', package: MINE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('first');
    expect(pickApplicationId(apps)).toBe('first');
  });
});
