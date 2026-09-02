import { describe, it, expect } from 'vitest';
import { encodeInvitation, decodeInvitation } from './invitation';

// A realistic invitation shape: nested object with a byte-array identity,
// exactly the kind of payload we want to hide behind a copy-safe code.
const SAMPLE = {
  invitations: [
    {
      groupId: '20150f8a24c5cd0569743966240da01966b91d85e1c1e3a535ba3de98b864f59',
      invitation: {
        invitation: {
          inviter_identity: [117, 166, 29, 200, 171, 136, 188, 45, 69, 32],
        },
      },
      groupAlias: 'Red',
    },
  ],
};

describe('invitation codec', () => {
  it('round-trips an invitation object through base64', () => {
    const code = encodeInvitation(SAMPLE);
    expect(typeof code).toBe('string');
    // base64 token must not look like raw JSON
    expect(code.startsWith('{')).toBe(false);
    expect(decodeInvitation(code)).toEqual(SAMPLE);
  });

  it('produces a base64-only token (no JSON punctuation)', () => {
    const code = encodeInvitation(SAMPLE);
    expect(code).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('still decodes raw JSON (backward compatibility)', () => {
    const raw = JSON.stringify(SAMPLE);
    expect(decodeInvitation(raw)).toEqual(SAMPLE);
  });

  it('tolerates surrounding + internal whitespace in a code', () => {
    const code = encodeInvitation(SAMPLE);
    const messy = `  ${code.slice(0, 8)}\n${code.slice(8)}  `;
    expect(decodeInvitation(messy)).toEqual(SAMPLE);
  });

  it('preserves unicode in captions/names', () => {
    const obj = { groupAlias: 'Café ☕ 团队', n: 1 };
    expect(decodeInvitation(encodeInvitation(obj))).toEqual(obj);
  });

  it('throws on empty input', () => {
    expect(() => decodeInvitation('   ')).toThrow();
  });

  it('throws on a non-base64 / non-JSON string', () => {
    // contains characters outside the base64 alphabet
    expect(() => decodeInvitation('not a code !!!')).toThrow();
  });

  it('throws when base64 decodes to non-JSON', () => {
    const garbage = encodeInvitation('plain string that is valid json actually');
    // valid JSON string -> fine; build a truly invalid one:
    const notJson = btoa('this is not json');
    expect(() => decodeInvitation(notJson)).toThrow();
    // sanity: the valid one does NOT throw
    expect(() => decodeInvitation(garbage)).not.toThrow();
  });
});
