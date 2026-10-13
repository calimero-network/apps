/**
 * Pins "which installed application is me".
 *
 * The rule that matters is the NEGATIVE one: with no match, return "" rather
 * than `apps[0]`. Guessing is how a workspace list ends up scoped to another
 * mero app's application id while looking like it ignores the filter.
 */
import { describe, expect, it } from 'vitest';
import { pickApplicationId } from './appId';
import { APP_PACKAGE } from '../config';

const other = { id: 'other-app', package: 'com.calimero.mero-stream', version: '9.9.9' };

describe('pickApplicationId', () => {
  it('matches on the bundle package, not on position', () => {
    expect(pickApplicationId([other, { id: 'mine', package: APP_PACKAGE }])).toBe('mine');
  });

  it('returns "" when this app is not installed — never apps[0]', () => {
    expect(pickApplicationId([other])).toBe('');
    expect(pickApplicationId([])).toBe('');
  });

  it('prefers the highest version when a registry and a dev build both match', () => {
    // Two installs of the same package have DIFFERENT ids: an id is
    // hash(package, signer).
    const apps = [
      { id: 'stale', package: APP_PACKAGE, version: '1.0.9' },
      { id: 'fresh', package: APP_PACKAGE, version: '1.1.0' },
    ];
    expect(pickApplicationId(apps)).toBe('fresh');
    expect(pickApplicationId([...apps].reverse())).toBe('fresh');
  });

  it('sorts an unparseable or missing version lowest', () => {
    expect(
      pickApplicationId([
        { id: 'versionless', package: APP_PACKAGE },
        { id: 'versioned', package: APP_PACKAGE, version: '0.0.1' },
      ]),
    ).toBe('versioned');
  });

  it('is stable for equal versions — the list must not shuffle between reads', () => {
    const apps = [
      { id: 'first', package: APP_PACKAGE, version: '1.0.0' },
      { id: 'second', package: APP_PACKAGE, version: '1.0.0' },
    ];
    expect(pickApplicationId(apps)).toBe('first');
  });

  it('ignores a matching package with no id', () => {
    expect(pickApplicationId([{ id: '', package: APP_PACKAGE }])).toBe('');
  });
});
