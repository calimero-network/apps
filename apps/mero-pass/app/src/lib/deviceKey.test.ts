// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  generateDeviceKey,
  generateVaultKey,
  unwrapVaultKey,
  wrapVaultKey,
} from '@calimero-network/mero-pass';
import {
  DeviceKeeper,
  type DeviceStore,
  NoDeviceKeyError,
  type PasskeyProvider,
  WrongPassphraseError,
} from './deviceKey';

function memoryStore(): DeviceStore & { value: unknown } {
  const s = {
    value: undefined as unknown,
    async get() {
      return s.value as never;
    },
    async put(v: unknown) {
      s.value = v;
    },
    async clear() {
      s.value = undefined;
    },
  };
  return s;
}

/** A browser set up before protection was required: an unprotected key. */
async function legacyStore() {
  const store = memoryStore();
  const pair = await generateDeviceKey();
  await store.put({
    kind: 'plain',
    privateKey: pair.privateKey,
    publicRaw: pair.publicRaw,
    createdAt: 0,
  });
  return store;
}

/** An authenticator whose PRF is HMAC under a secret it never reveals. */
function fakePasskeys(): PasskeyProvider & { uses: number } {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const p = {
    uses: 0,
    async create() {
      return { credentialId: new Uint8Array([1, 2, 3]) };
    },
    async prf(credentialId: Uint8Array, salt: Uint8Array) {
      p.uses += 1;
      const k = await crypto.subtle.importKey(
        'raw',
        secret,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const msg = new Uint8Array([...credentialId, ...salt]);
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
    },
  };
  return p;
}

describe('DeviceKeeper', () => {
  it('never makes an unprotected key: the first one is sealed', async () => {
    const store = memoryStore();
    const keeper = new DeviceKeeper(store);
    expect(await keeper.protection()).toBe('missing');
    await expect(keeper.unlock()).rejects.toBeInstanceOf(NoDeviceKeyError);
    expect(store.value).toBeUndefined();

    let handedOver = false;
    await keeper.setPassphrase('correct horse', async () => {
      handedOver = true;
    });
    expect(handedOver).toBe(true);
    expect(await keeper.protection()).toBe('passphrase');
  }, 20_000);

  it('still opens a key from before protection was required', async () => {
    const keeper = new DeviceKeeper(await legacyStore());
    const first = await keeper.unlock();
    const fp = keeper.fingerprint;
    keeper.lock();
    expect(keeper.isUnlocked).toBe(false);
    expect(keeper.device).toBeNull();
    await keeper.unlock();
    expect(keeper.fingerprint).toBe(fp);
    expect(keeper.device?.publicRaw).toEqual(first.publicRaw);
    expect(await keeper.protection()).toBe('none');
  });

  it('with a passphrase, stores nothing usable and needs it to unlock', async () => {
    const store = memoryStore();
    const keeper = new DeviceKeeper(store);
    const fp = await keeper.setPassphrase('correct horse', async () => {});
    expect(await keeper.protection()).toBe('passphrase');
    expect(JSON.stringify(store.value)).not.toContain('privateKey');

    // A vault key wrapped to the protected device opens once unlocked.
    const vk = await generateVaultKey();
    const wrap = await wrapVaultKey(vk, keeper.device!.publicRaw);
    keeper.lock();

    await expect(keeper.unlock()).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(keeper.unlock('wrong horse')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );

    const pair = await keeper.unlock('correct horse');
    expect(keeper.fingerprint).toBe(fp);
    expect(pair.privateKey.extractable).toBe(false);
    expect((await unwrapVaultKey(wrap, vk.keyId, pair))?.keyId).toBe(vk.keyId);
  }, 20_000);

  it('refuses a passphrase under 8 characters', async () => {
    const keeper = new DeviceKeeper(memoryStore());
    await expect(
      keeper.setPassphrase('1234567', async () => {}),
    ).rejects.toThrow(/8 characters/);
  });

  it('with a passkey, unlocks through the authenticator only', async () => {
    const store = memoryStore();
    const passkeys = fakePasskeys();
    const keeper = new DeviceKeeper(store, passkeys);
    const fp = await keeper.setPasskey(async () => {});
    expect(await keeper.protection()).toBe('passkey');
    keeper.lock();

    await keeper.unlock();
    expect(keeper.fingerprint).toBe(fp);
    expect(passkeys.uses).toBe(2);

    // A different authenticator derives a different key.
    const other = new DeviceKeeper(store, fakePasskeys());
    await expect(other.unlock()).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('keeps the old key when the hand-over fails', async () => {
    const keeper = new DeviceKeeper(await legacyStore());
    await keeper.unlock();
    const before = keeper.fingerprint;
    await expect(
      keeper.setPassphrase('correct horse', async () => {
        throw new Error('node down');
      }),
    ).rejects.toThrow('node down');
    expect(await keeper.protection()).toBe('none');
    expect(keeper.fingerprint).toBe(before);
  });

  it('reset forgets the key, and the next one is protected again', async () => {
    const store = memoryStore();
    const keeper = new DeviceKeeper(store);
    await keeper.setPassphrase('correct horse', async () => {});
    const before = keeper.fingerprint;
    await keeper.reset();
    expect(keeper.isUnlocked).toBe(false);
    expect(await keeper.protection()).toBe('missing');
    await keeper.setPassphrase('battery staple', async () => {});
    expect(keeper.fingerprint).not.toBe(before);
    expect(await keeper.protection()).toBe('passphrase');
  }, 20_000);
});
