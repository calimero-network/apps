import { describe, expect, it } from 'vitest';
import {
  integrityWarning,
  sha256Hex,
  verifyDocumentBytes,
} from './documentIntegrity';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('document integrity', () => {
  it('accepts bytes whose hash matches what was recorded', async () => {
    const b = bytes('a signed agreement');
    const res = await verifyDocumentBytes(
      b,
      await sha256Hex(bytes('a signed agreement')),
    );
    expect(res).toEqual({ checked: true, ok: true });
  });

  it('is case-insensitive about the recorded hash', async () => {
    const b = bytes('contract');
    const upper = (await sha256Hex(bytes('contract'))).toUpperCase();
    expect(await verifyDocumentBytes(b, upper)).toEqual({
      checked: true,
      ok: true,
    });
  });

  // The whole point: before this, a blob that came back as something else
  // rendered without a word.
  it('reports bytes that are not the document that was recorded', async () => {
    const res = await verifyDocumentBytes(
      bytes('a DIFFERENT agreement'),
      await sha256Hex(bytes('a signed agreement')),
    );
    expect(res.checked).toBe(true);
    expect(res.checked && res.ok).toBe(false);
    expect(integrityWarning(res)).toMatch(/do not match the hash recorded/);
  });

  // Live data predates this check, so "cannot say" must not read as "fine".
  it('distinguishes "no hash recorded" from "hash matches"', async () => {
    for (const absent of ['', '   ', undefined, null]) {
      expect(await verifyDocumentBytes(bytes('x'), absent)).toEqual({
        checked: false,
        reason: 'no-hash-recorded',
      });
    }
    expect(
      integrityWarning({ checked: false, reason: 'no-hash-recorded' }),
    ).toBeNull();
  });

  it('says nothing when the bytes are good', async () => {
    expect(integrityWarning({ checked: true, ok: true })).toBeNull();
  });
});
