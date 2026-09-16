import { describe, expect, it } from 'vitest';
import {
  APP_SLUG,
  decodeInvitationPayload,
  encodeInvitationPayload,
  generateInvitationUrl,
  parseInvitationInput,
} from './invitation';

/** A recursive invitation, the shape the lobby actually emits. */
const PAYLOAD = JSON.stringify({
  invitations: [
    {
      groupId: [1, 2, 3],
      groupAlias: 'lobby',
      invitation: { inviter_account: 'ab'.repeat(32), body: { nonce: 7 } },
      inviterSignature: 'cd'.repeat(32),
    },
  ],
});

describe('encode / decode', () => {
  it('round-trips a payload', () => {
    expect(decodeInvitationPayload(encodeInvitationPayload(PAYLOAD))).toBe(PAYLOAD);
  });

  it('compresses — the link has to survive being pasted into a chat', () => {
    expect(encodeInvitationPayload(PAYLOAD).length).toBeLessThan(PAYLOAD.length);
  });

  it('still reads an uncompressed base58 blob, because old links exist', () => {
    // Deliberately NOT deflated: the fallback branch is what stops a link
    // someone already sent from breaking when the format moves on.
    const bs58 = require('bs58').default ?? require('bs58');
    const raw = bs58.encode(new TextEncoder().encode(PAYLOAD));
    expect(decodeInvitationPayload(raw)).toBe(PAYLOAD);
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(decodeInvitationPayload('')).toBeNull();
    expect(decodeInvitationPayload('   ')).toBeNull();
  });
});

describe('generateInvitationUrl', () => {
  it('wraps the payload in a links.calimero.network URL keyed by the package id', () => {
    const url = new URL(generateInvitationUrl(PAYLOAD));
    expect(url.host).toBe('links.calimero.network');
    // The slug IS the bundle's package id — the desktop resolves a link by
    // matching `Application.package`, so a display-name slug opens nothing.
    expect(url.pathname).toBe(`/${APP_SLUG}/join`);
    expect(decodeInvitationPayload(url.searchParams.get('invitation')!)).toBe(PAYLOAD);
  });
});

describe('parseInvitationInput', () => {
  it('accepts the whole https link', () => {
    expect(parseInvitationInput(generateInvitationUrl(PAYLOAD))).toBe(PAYLOAD);
  });

  it('accepts a bare encoded blob', () => {
    expect(parseInvitationInput(encodeInvitationPayload(PAYLOAD))).toBe(PAYLOAD);
  });

  it('still accepts raw JSON — every invitation issued before links was one', () => {
    expect(parseInvitationInput(PAYLOAD)).toBe(PAYLOAD);
  });

  it('tolerates the whitespace a copy-paste brings with it', () => {
    expect(parseInvitationInput(`  ${generateInvitationUrl(PAYLOAD)}  \n`)).toBe(PAYLOAD);
  });

  it('returns null for a link carrying no invitation', () => {
    expect(
      parseInvitationInput(`https://links.calimero.network/${APP_SLUG}/join`),
    ).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseInvitationInput('')).toBeNull();
    expect(parseInvitationInput('   ')).toBeNull();
  });
});
