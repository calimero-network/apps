import { describe, expect, it } from 'vitest';
import {
  APP_SLUG,
  decodeInvitationPayload,
  encodeInvitationPayload,
  generateInvitationUrl,
  readLobbyInvitation,
} from './invitation';
import { INVITER_KEY } from './knownPlayers';
import { EMBEDDED_NAME_KEY } from './lobbyName';

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

describe('readLobbyInvitation', () => {
  const token = (payload: unknown) =>
    new URL(generateInvitationUrl(JSON.stringify(payload))).searchParams.get('invitation')!;

  it('reads a recursive invitation, handing the signed invitation on untouched', () => {
    const parsed = JSON.parse(PAYLOAD);
    const read = readLobbyInvitation(token(parsed));
    expect(read).toEqual({
      namespaceId: '010203',
      invitation: parsed.invitations[0].invitation,
      groupAlias: 'lobby',
      lobbyName: 'lobby',
      inviterKey: undefined,
    });
  });

  it('reads a single invitation by its byte group id', () => {
    const single = { invitation: { groupId: [10, 11] }, inviterSignature: 'sig' };
    const read = readLobbyInvitation(token(single));
    expect(read?.namespaceId).toBe('0a0b');
    expect(read?.invitation).toEqual(single);
  });

  it('carries the lobby name and inviter key the inviter embedded beside it', () => {
    const key = 'ef'.repeat(32);
    const read = readLobbyInvitation(
      token({ ...JSON.parse(PAYLOAD), [EMBEDDED_NAME_KEY]: 'Friday', [INVITER_KEY]: key }),
    );
    expect(read?.lobbyName).toBe('Friday');
    expect(read?.inviterKey).toBe(key);
  });

  it('returns null for a token that names no namespace, or is not one', () => {
    expect(readLobbyInvitation(token({ hello: 'world' }))).toBeNull();
    expect(readLobbyInvitation('')).toBeNull();
    expect(readLobbyInvitation(encodeInvitationPayload('not json'))).toBeNull();
  });
});
