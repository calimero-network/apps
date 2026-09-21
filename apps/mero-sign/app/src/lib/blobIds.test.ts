import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';

import { isUsableBlobId, toBlobIdHex } from './blobIds';

const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = Array.from(BYTES)
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
const BASE58 = bs58.encode(BYTES);

describe('toBlobIdHex', () => {
  it('passes hex through, lowercased', () => {
    expect(toBlobIdHex(HEX)).toBe(HEX);
    expect(toBlobIdHex(HEX.toUpperCase())).toBe(HEX);
    expect(toBlobIdHex(`0x${HEX}`)).toBe(HEX);
  });

  it('hex-encodes the byte array the contract returns', () => {
    // `blob_id` comes back as `[u8; 32]` from some methods and as a string
    // from others; both used to be handled with `bs58.encode`.
    expect(toBlobIdHex([...BYTES])).toBe(HEX);
    expect(toBlobIdHex(BYTES)).toBe(HEX);
  });

  it('converts a LEGACY base58 id back to the hex it came from', () => {
    // The whole reason this is not a straight deletion: ids written by the
    // previous build are already in the contract, and the blob behind them is
    // still on the node under its hex id. Losing them would blank every
    // document and signature saved before the fix.
    expect(toBlobIdHex(BASE58)).toBe(HEX);
  });

  it('round-trips the exact id from the reported error', () => {
    // "Failed to decode blob ID (expected hex)
    //  'EV2HzEPbzzmRGyHke9CFbKFfgvWYheS7ZBLkgu1xEo6': Odd number of digits"
    const reported = 'EV2HzEPbzzmRGyHke9CFbKFfgvWYheS7ZBLkgu1xEo6';
    const hex = toBlobIdHex(reported);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // And the conversion is exact, not lossy.
    expect(bs58.encode(Uint8Array.from(Buffer.from(hex, 'hex')))).toBe(
      reported,
    );
  });

  it('refuses what it cannot turn into a blob id, rather than passing it on', () => {
    // Sending one of these to the node is the 500 this module prevents.
    for (const junk of ['', '   ', 'not-an-id', 'zz', HEX.slice(0, 40)]) {
      expect(toBlobIdHex(junk)).toBe('');
    }
    // Right alphabet, wrong length.
    expect(toBlobIdHex(bs58.encode(new Uint8Array(16)))).toBe('');
    expect(toBlobIdHex([1, 2, 3])).toBe('');
  });
});

describe('isUsableBlobId', () => {
  it('agrees with what the node will accept', () => {
    expect(isUsableBlobId(HEX)).toBe(true);
    expect(isUsableBlobId(BASE58)).toBe(true);
    expect(isUsableBlobId([...BYTES])).toBe(true);
    expect(isUsableBlobId('nope')).toBe(false);
  });
});
