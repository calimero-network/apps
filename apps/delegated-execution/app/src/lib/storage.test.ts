import { beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_SETTINGS, clearStored, loadIdentity, loadSettings, nonceStorageKey, saveIdentity, saveSettings } from './storage.js';
import type { DeviceIdentity } from './identity.js';

const IDENTITY: DeviceIdentity = {
  accountId: 'a'.repeat(64),
  deviceId: 'b'.repeat(64),
  deviceSecret: 'c'.repeat(64),
  devicePublicKey: 'd'.repeat(64),
  credential: 'e'.repeat(474),
};

beforeEach(() => {
  localStorage.clear();
});

describe('identity persistence', () => {
  it('round-trips what a reload needs', () => {
    saveIdentity(IDENTITY);
    expect(loadIdentity()).toEqual(IDENTITY);
  });

  it('refuses a half-written identity rather than loading it', () => {
    // The failure this prevents: an identity written by an older shape loads
    // with `credential: undefined`, every signature is refused, and the error
    // points at the node.
    localStorage.setItem(
      'calimero.delegated-demo.identity',
      JSON.stringify({ accountId: IDENTITY.accountId }),
    );
    expect(loadIdentity()).toBeNull();
  });

  it('treats unparseable storage as absence', () => {
    localStorage.setItem('calimero.delegated-demo.identity', 'not json');
    expect(loadIdentity()).toBeNull();
  });
});

describe('clearStored', () => {
  it('takes the nonce counter with the identity', () => {
    saveIdentity(IDENTITY);
    localStorage.setItem(nonceStorageKey(IDENTITY.devicePublicKey), '9');

    clearStored(IDENTITY.devicePublicKey);

    expect(loadIdentity()).toBeNull();
    // The combination that produces replayed warrants: a counter that outlives
    // the device it counted for.
    expect(localStorage.getItem(nonceStorageKey(IDENTITY.devicePublicKey))).toBeNull();
  });

  it('is a no-op when there was no identity', () => {
    expect(() => clearStored(null)).not.toThrow();
  });
});

describe('settings', () => {
  it('starts empty rather than guessing a node', () => {
    expect(loadSettings()).toEqual(EMPTY_SETTINGS);
  });

  it('fills missing fields from the empty defaults', () => {
    // A settings blob written before a field existed must not load as
    // `undefined` and render an uncontrolled input.
    localStorage.setItem(
      'calimero.delegated-demo.settings',
      JSON.stringify({ nodeUrl: 'http://127.0.0.1:2428' }),
    );
    expect(loadSettings()).toEqual({
      nodeUrl: 'http://127.0.0.1:2428',
      nodeKey: '',
      contextId: '',
    });
  });

  it('round-trips', () => {
    const settings = { nodeUrl: 'http://n', nodeKey: 'f'.repeat(64), contextId: '1'.repeat(64) };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });
});

describe('nonceStorageKey', () => {
  it('is per device, so two devices never share a counter', () => {
    expect(nonceStorageKey('a'.repeat(64))).not.toBe(nonceStorageKey('b'.repeat(64)));
  });
});
