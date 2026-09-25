// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { generateVaultKey, unwrapVaultKey, wrapVaultKey } from './crypto';
import { DeviceKeeper, type DeviceStore, WrongPinError } from './deviceKey';

function memoryStore(): DeviceStore & { value: unknown } {
  const s = {
    value: undefined as unknown,
    async get() {
      return s.value as never;
    },
    async put(v: unknown) {
      s.value = v;
    },
  };
  return s;
}

describe('DeviceKeeper', () => {
  it('creates a key on first unlock and reuses it after a lock', async () => {
    const store = memoryStore();
    const keeper = new DeviceKeeper(store);
    const first = await keeper.unlock();
    const fp = keeper.fingerprint;
    keeper.lock();
    expect(keeper.isUnlocked).toBe(false);
    expect(keeper.device).toBeNull();
    await keeper.unlock();
    expect(keeper.fingerprint).toBe(fp);
    expect(keeper.device?.publicRaw).toEqual(first.publicRaw);
  });

  it('with a PIN, stores nothing usable and needs the PIN to unlock', async () => {
    const store = memoryStore();
    const keeper = new DeviceKeeper(store);
    const fp = await keeper.setPin('2468');
    expect(await keeper.hasPin()).toBe(true);
    expect(JSON.stringify(store.value)).not.toContain('privateKey');

    // A vault key wrapped to the PIN device opens once unlocked.
    const vk = await generateVaultKey();
    const wrap = await wrapVaultKey(vk, keeper.device!.publicRaw);
    keeper.lock();

    await expect(keeper.unlock()).rejects.toBeInstanceOf(WrongPinError);
    await expect(keeper.unlock('0000')).rejects.toBeInstanceOf(WrongPinError);

    const pair = await keeper.unlock('2468');
    expect(keeper.fingerprint).toBe(fp);
    expect(pair.privateKey.extractable).toBe(false);
    expect((await unwrapVaultKey(wrap, vk.keyId, pair))?.keyId).toBe(vk.keyId);
  }, 20_000);

  it('refuses a PIN that is too short', async () => {
    const keeper = new DeviceKeeper(memoryStore());
    await expect(keeper.setPin('12')).rejects.toThrow();
  });
});
