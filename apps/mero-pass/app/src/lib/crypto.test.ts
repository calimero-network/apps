// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  Keyring,
  SealError,
  fingerprintOf,
  generateDeviceKey,
  generateVaultKey,
  keyIdOf,
  newSecretId,
  openField,
  sealField,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto';

describe('device keys', () => {
  it('fingerprints the raw public key as 64 hex', async () => {
    const d = await generateDeviceKey();
    expect(d.publicRaw.length).toBe(65);
    const fp = await fingerprintOf(d.publicRaw);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintOf(d.publicRaw)).toBe(fp);
  });

  it('keeps the private half non-extractable', async () => {
    const d = await generateDeviceKey();
    expect(d.privateKey.extractable).toBe(false);
  });
});

describe('key wrapping', () => {
  it('round-trips a vault key to its recipient only', async () => {
    const alice = await generateDeviceKey();
    const bob = await generateDeviceKey();
    const key = await generateVaultKey();

    const toBob = await wrapVaultKey(key, bob.publicRaw);
    const opened = await unwrapVaultKey(toBob, key.keyId, bob);
    expect(opened?.keyId).toBe(key.keyId);

    expect(await unwrapVaultKey(toBob, key.keyId, alice)).toBeNull();
  });

  it('rejects a wrap whose key does not match the advertised key id', async () => {
    const bob = await generateDeviceKey();
    const real = await generateVaultKey();
    const forged = await generateVaultKey();
    // A hostile member wraps THEIR key but labels it as the vault's.
    const wrap = await wrapVaultKey(forged, bob.publicRaw);
    expect(await unwrapVaultKey(wrap, real.keyId, bob)).toBeNull();
  });

  it('treats garbage as no wrap rather than throwing', async () => {
    const bob = await generateDeviceKey();
    expect(await unwrapVaultKey('not json', 'x', bob)).toBeNull();
    expect(await unwrapVaultKey('{"v":2}', 'x', bob)).toBeNull();
  });
});

describe('field sealing', () => {
  it('round-trips and names its key', async () => {
    const key = await generateVaultKey();
    const ring = new Keyring();
    ring.add(key);
    const id = newSecretId();
    const env = await sealField(key, id, 'password', 'hunter2');
    expect(env).not.toContain('hunter2');
    expect(keyIdOf(env)).toBe(key.keyId);
    expect(await openField(ring, id, 'password', env)).toBe('hunter2');
  });

  it('seals the same value differently each time', async () => {
    const key = await generateVaultKey();
    const id = newSecretId();
    const a = await sealField(key, id, 'password', 'same');
    const b = await sealField(key, id, 'password', 'same');
    expect(a).not.toBe(b);
  });

  it('refuses an envelope moved to another field or another secret', async () => {
    const key = await generateVaultKey();
    const ring = new Keyring();
    ring.add(key);
    const a = newSecretId();
    const b = newSecretId();
    const env = await sealField(key, a, 'password', 'secret');
    await expect(openField(ring, a, 'notes', env)).rejects.toBeInstanceOf(
      SealError,
    );
    await expect(openField(ring, b, 'password', env)).rejects.toBeInstanceOf(
      SealError,
    );
  });

  it('cannot open a value under a key it was never given', async () => {
    const key = await generateVaultKey();
    const id = newSecretId();
    const env = await sealField(key, id, 'password', 'x');
    await expect(
      openField(new Keyring(), id, 'password', env),
    ).rejects.toBeInstanceOf(SealError);
  });

  it('keeps old keys usable after a rotation', async () => {
    const k1 = await generateVaultKey();
    const k2 = await generateVaultKey();
    const ring = new Keyring();
    ring.add(k1);
    ring.add(k2);
    const id = newSecretId();
    const old = await sealField(k1, id, 'password', 'v1');
    const cur = await sealField(k2, id, 'password', 'v2');
    expect(await openField(ring, id, 'password', old)).toBe('v1');
    expect(await openField(ring, id, 'password', cur)).toBe('v2');
  });

  it('maps empty to empty, so a cleared field stays cleared', async () => {
    const key = await generateVaultKey();
    expect(await sealField(key, newSecretId(), 'url', '')).toBe('');
    expect(await openField(new Keyring(), 'x', 'url', '')).toBe('');
  });

  it('mints ids in the shape the contract requires', () => {
    expect(newSecretId()).toMatch(/^secret_[0-9a-f]{32}$/);
  });
});
