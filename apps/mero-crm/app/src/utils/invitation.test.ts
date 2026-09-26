import { describe, it, expect } from 'vitest';
import {
  APP_SLUG,
  decodeInvitation,
  encodeInvitation,
  generateInvitationDeepLink,
  generateInvitationUrl,
  parseInvitationInput,
} from './invitation';
import { APP_PACKAGE } from '../config';

/** Deterministic stand-in for a 32/64-byte identity or signature blob. */
const bytes = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => (i * 37 + seed * 101) % 256);

// Mirrors a real namespace invitation: the byte-array blobs are what make the
// payload big, and they are why the codec compresses before encoding. Using a
// realistic size here keeps the length assertions meaningful — a toy object is
// small enough that base58's ~1.37x expansion outweighs any compression.
const SAMPLE = {
  invitations: [
    {
      groupId: '20150f8a24c5cd0569743966240da01966b91d85e1c1e3a535ba3de98b864f59',
      invitation: {
        invitation: {
          inviter_identity: bytes(32, 1),
          invitee_identity: bytes(32, 2),
          group_id: bytes(32, 3),
          context_id: bytes(32, 4),
          expires_at: 1786000000000,
        },
        inviter_signature: bytes(64, 5),
      },
      groupAlias: 'Engineering',
    },
  ],
};

describe('invitation codec', () => {
  it('round-trips an invitation object', () => {
    const code = encodeInvitation(SAMPLE);
    expect(code.startsWith('{')).toBe(false);
    expect(decodeInvitation(code)).toEqual(SAMPLE);
  });

  it('produces a base58 token (no URL-unsafe characters)', () => {
    expect(encodeInvitation(SAMPLE)).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('is markedly shorter than the base64 it replaced', () => {
    const json = JSON.stringify(SAMPLE);
    const base64Length = Buffer.from(json, 'utf8').toString('base64').length;
    expect(encodeInvitation(SAMPLE).length).toBeLessThan(base64Length * 0.75);
  });

  it('still decodes raw JSON (backward compatibility)', () => {
    expect(decodeInvitation(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
  });

  it('still decodes a legacy plain-base64 code', () => {
    const legacy = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(SAMPLE))),
    );
    expect(decodeInvitation(legacy)).toEqual(SAMPLE);
  });

  it('tolerates surrounding + internal whitespace in a code', () => {
    const code = encodeInvitation(SAMPLE);
    expect(decodeInvitation(`  ${code.slice(0, 8)}\n${code.slice(8)}  `)).toEqual(SAMPLE);
  });

  it('preserves unicode in names', () => {
    const obj = { groupAlias: 'Café ☕ 团队', n: 1 };
    expect(decodeInvitation(encodeInvitation(obj))).toEqual(obj);
  });

  it('throws on empty input', () => {
    expect(() => decodeInvitation('   ')).toThrow();
  });

  it('throws on a string that decodes to nothing meaningful', () => {
    expect(() => decodeInvitation('not a code !!!')).toThrow();
    expect(() => decodeInvitation(btoa('this is not json'))).toThrow();
  });
});

describe('shareable links', () => {
  const payload = JSON.stringify(SAMPLE);

  it('builds an HTTPS link on the deep-link host, slugged by package id', () => {
    const url = new URL(generateInvitationUrl(payload));
    expect(url.origin).toBe('https://links.calimero.network');
    expect(url.pathname).toBe(`/${APP_PACKAGE}/join`);
    expect(url.searchParams.get('invitation')).toBeTruthy();
  });

  it('keeps the slug equal to the published package id', () => {
    // The desktop launcher resolves by Application.package and the landing page
    // asks the registry for that same package, so a friendly name would break both.
    expect(APP_SLUG).toBe(APP_PACKAGE);
  });

  it('builds a calimero:// link for platforms that cannot intercept HTTPS', () => {
    expect(generateInvitationDeepLink(payload)).toMatch(
      new RegExp(`^calimero://${APP_PACKAGE}/join\\?invitation=.+`),
    );
  });

  it('round-trips the payload through the web link', () => {
    expect(parseInvitationInput(generateInvitationUrl(payload))).toBe(payload);
  });

  it('round-trips the payload through the desktop link', () => {
    expect(parseInvitationInput(generateInvitationDeepLink(payload))).toBe(payload);
  });

  it('accepts a pasted link, a bare code, or raw JSON', () => {
    expect(decodeInvitation(generateInvitationUrl(payload))).toEqual(SAMPLE);
    expect(decodeInvitation(encodeInvitation(SAMPLE))).toEqual(SAMPLE);
    expect(decodeInvitation(payload)).toEqual(SAMPLE);
  });

  it('rejects a link with no invitation param', () => {
    expect(parseInvitationInput('https://links.calimero.network/x/join')).toBeNull();
  });
});
