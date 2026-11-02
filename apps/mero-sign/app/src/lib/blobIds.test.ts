import { describe, expect, it } from 'vitest';

import { isUsableBlobId, toBlobIdHex } from './blobIds';

const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = Array.from(BYTES)
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

describe('toBlobIdHex', () => {
  it('passes hex through, lowercased', () => {
    expect(toBlobIdHex(HEX)).toBe(HEX);
    expect(toBlobIdHex(HEX.toUpperCase())).toBe(HEX);
    expect(toBlobIdHex(`0x${HEX}`)).toBe(HEX);
  });

  it('hex-encodes a 32-byte array', () => {
    expect(toBlobIdHex([...BYTES])).toBe(HEX);
    expect(toBlobIdHex(BYTES)).toBe(HEX);
  });

  it('refuses what it cannot turn into a blob id', () => {
    for (const junk of ['', '   ', 'not-an-id', 'zz', HEX.slice(0, 40)]) {
      expect(toBlobIdHex(junk)).toBe('');
    }
    // base58 is not a blob id any more.
    expect(toBlobIdHex('EV2HzEPbzzmRGyHke9CFbKFfgvWYheS7ZBLkgu1xEo6')).toBe('');
    expect(toBlobIdHex([1, 2, 3])).toBe('');
  });
});

describe('isUsableBlobId', () => {
  it('agrees with what the node will accept', () => {
    expect(isUsableBlobId(HEX)).toBe(true);
    expect(isUsableBlobId('nope')).toBe(false);
  });
});
