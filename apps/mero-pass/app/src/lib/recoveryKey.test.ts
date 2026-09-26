// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  generateVaultKey,
  toB64,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto';
import {
  RecoveryCodeError,
  createRecoveryKey,
  decodeRecoveryCode,
  encodeRecoveryCode,
  recoveryPairFrom,
} from './recoveryKey';

describe('recovery codes', () => {
  it('round-trip 35 bytes through 14 groups of 4', () => {
    const bytes = new Uint8Array(35).map((_, i) => (i * 37 + 11) & 0xff);
    const code = encodeRecoveryCode(bytes);
    expect(code).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(decodeRecoveryCode(code)).toEqual(bytes);
    // Forgiving about case, spacing and look-alike letters.
    const sloppy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    expect(decodeRecoveryCode(sloppy)).toEqual(bytes);
  });

  it('refuses a code of the wrong length or alphabet', () => {
    expect(() => decodeRecoveryCode('ABCD')).toThrow(RecoveryCodeError);
    expect(() => decodeRecoveryCode('U'.repeat(56))).toThrow(RecoveryCodeError);
  });
});

describe('recovery key', () => {
  it('rebuilds from its code and opens what was wrapped to it', async () => {
    const key = await createRecoveryKey();
    const registered = {
      fingerprint: key.fingerprint,
      public_key: toB64(key.publicRaw),
      kind: 'recovery',
    };
    const vk = await generateVaultKey();
    const wrap = await wrapVaultKey(vk, key.publicRaw);

    const pair = await recoveryPairFrom(key.code, [registered]);
    expect(pair?.fingerprint).toBe(key.fingerprint);
    expect(pair!.device.privateKey.extractable).toBe(false);
    expect((await unwrapVaultKey(wrap, vk.keyId, pair!.device))?.keyId).toBe(
      vk.keyId,
    );
  });

  it('matches only recovery devices with its fingerprint', async () => {
    const key = await createRecoveryKey();
    const other = await createRecoveryKey();
    const as = (k: typeof key, kind: string) => ({
      fingerprint: k.fingerprint,
      public_key: toB64(k.publicRaw),
      kind,
    });
    expect(
      await recoveryPairFrom(key.code, [as(other, 'recovery')]),
    ).toBeNull();
    expect(await recoveryPairFrom(key.code, [as(key, 'browser')])).toBeNull();
  });
});
