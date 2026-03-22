import { describe, expect, it } from 'vitest';
import { normalizeContextIdForJoin } from './contextIdJoin';

describe('normalizeContextIdForJoin', () => {
  it('converts 64-char lowercase hex to base58', () => {
    const hex =
      '0000000000000000000000000000000000000000000000000000000000000001';
    const out = normalizeContextIdForJoin(hex);
    expect(out).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(out).not.toBe(hex);
  });

  it('converts 64-char uppercase hex', () => {
    const hex =
      'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
    const out = normalizeContextIdForJoin(hex);
    expect(out.length).toBeGreaterThan(0);
  });

  it('passes through non-hex strings unchanged', () => {
    const b58 = '3jLicRUbTH7D6WFaGW7gkjvxJ6eztPe7Dc5GXv7Dng9M';
    expect(normalizeContextIdForJoin(b58)).toBe(b58);
  });

  it('passes through wrong-length hex unchanged', () => {
    const shortHex = 'deadbeef';
    expect(normalizeContextIdForJoin(shortHex)).toBe(shortHex);
  });
});
