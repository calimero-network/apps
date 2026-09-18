import { describe, expect, it } from 'vitest';
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  type SheetsInvitePayload,
  type SignedInvitation,
} from './inviteCodec';

/** A realistic `SignedGroupOpenInvitation`: a byte-array group id and a signature. */
const GROUP_BYTES = Array.from({ length: 32 }, (_, i) => i + 1);
const GROUP_HEX = GROUP_BYTES.map((b) => b.toString(16).padStart(2, '0')).join('');

const SIGNED: SignedInvitation = {
  invitation: {
    groupId: GROUP_BYTES,
    inviter_identity: [117, 166, 29, 200, 171, 136, 188, 45, 69, 32],
    expiration: 1893456000000,
  },
  inviterSignature: 'a'.repeat(128),
};

const PAYLOAD: SheetsInvitePayload = {
  invitation: SIGNED,
  kind: 'namespace',
  groupId: GROUP_HEX,
  groupAlias: 'Finance team',
  contextId: 'ctx-1234567890',
  projectName: 'Q3 Budget',
};

describe('encodeInvite / decodeInvite', () => {
  it('round-trips a payload', () => {
    const decoded = decodeInvite(encodeInvite(PAYLOAD));
    expect(decoded).not.toBeNull();
    expect(decoded!.groupAlias).toBe('Finance team');
    expect(decoded!.projectName).toBe('Q3 Budget');
    expect(decoded!.contextId).toBe('ctx-1234567890');
    expect(decoded!.kind).toBe('namespace');
    expect(decoded!.invitation).toEqual(SIGNED);
  });

  it('produces a code with no URL-hostile characters', () => {
    // The whole reason for base58 over the base64 this app used to emit: `+`,
    // `/` and `=` are exactly what URL encoders, chat clients and shell quoting
    // mangle, and mangling is what happens to an invite code.
    const code = encodeInvite(PAYLOAD);
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(code).not.toContain('=');
    expect(code).not.toContain('+');
    expect(code).not.toContain('/');
  });

  it('compresses — the code is shorter than the JSON it carries', () => {
    const code = encodeInvite(PAYLOAD);
    expect(code.length).toBeLessThan(JSON.stringify(PAYLOAD).length);
  });

  it('preserves unicode in names', () => {
    const decoded = decodeInvite(
      encodeInvite({ ...PAYLOAD, projectName: 'Café ☕ 团队' }),
    );
    expect(decoded!.projectName).toBe('Café ☕ 团队');
  });

  it('also writes mero-stream’s `roomName` spelling, so a sheets code reads there', () => {
    const json = JSON.stringify({ ...PAYLOAD, roomName: PAYLOAD.projectName });
    // Not asserting byte equality (deflate is not required to be stable across
    // inputs); asserting that the alias field is carried at all.
    const code = encodeInvite(PAYLOAD);
    const decoded = decodeInvite(code)!;
    expect(decoded.projectName).toBe('Q3 Budget');
    expect(json).toContain('roomName');
  });

  it('reads a payload that only has the `roomName` spelling', () => {
    // A code minted by mero-stream. Its "room" is our "spreadsheet".
    const fromStream = encodeInvite({
      invitation: SIGNED,
    } as SheetsInvitePayload);
    expect(decodeInvite(fromStream)).not.toBeNull();

    const raw = JSON.stringify({ invitation: SIGNED, roomName: 'Standup' });
    expect(decodeInvite(raw)!.projectName).toBe('Standup');
  });

  it('accepts raw JSON, including an admin-api {data:…} envelope', () => {
    expect(decodeInvite(JSON.stringify(PAYLOAD))!.groupAlias).toBe('Finance team');
    expect(
      decodeInvite(JSON.stringify({ data: PAYLOAD }))!.projectName,
    ).toBe('Q3 Budget');
  });

  it('accepts a bare SignedGroupOpenInvitation', () => {
    const decoded = decodeInvite(JSON.stringify(SIGNED));
    expect(decoded).not.toBeNull();
    expect(decoded!.invitation).toEqual(SIGNED);
  });

  it('still reads the base64 codes this app used to mint', () => {
    // The deleted `utils/invitation.ts` base64'd the raw `{invitations: […]}`
    // response from `createNamespaceInvitation(ns, {recursive: true})`. Someone
    // may still be holding one of those codes; changing our minds about the
    // encoding should not break it.
    const legacy = {
      invitations: [
        { groupId: GROUP_HEX, invitation: SIGNED, groupAlias: 'Finance team' },
      ],
    };
    const b64 = Buffer.from(JSON.stringify(legacy), 'utf-8').toString('base64');
    const decoded = decodeInvite(b64);
    expect(decoded).not.toBeNull();
    expect(decoded!.groupAlias).toBe('Finance team');
    expect(decoded!.invitation).toEqual(SIGNED);
  });

  it('tolerates whitespace a copy/paste introduces', () => {
    const code = encodeInvite(PAYLOAD);
    const messy = `  ${code.slice(0, 20)}\n  ${code.slice(20)} \n`;
    expect(decodeInvite(messy)!.groupAlias).toBe('Finance team');
  });

  it('returns null rather than throwing on junk', () => {
    // This is user input. Every caller wants "that code is not valid".
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('    ')).toBeNull();
    expect(decodeInvite('not a code !!!')).toBeNull();
    expect(decodeInvite('{"nope": true}')).toBeNull();
    // Valid base58 of bytes that are not JSON.
    expect(decodeInvite('3yZe7d')).toBeNull();
  });

  it('drops an unsigned wrapper instead of trusting it', () => {
    const forged = JSON.stringify({ invitation: { groupId: GROUP_HEX } });
    expect(decodeInvite(forged)).toBeNull();
  });
});

describe('namespaceIdOfInvite', () => {
  it('hex-encodes a byte-array group id from inside the SIGNED blob', () => {
    expect(namespaceIdOfInvite(PAYLOAD)).toBe(GROUP_HEX);
    expect(namespaceIdOfInvite(SIGNED)).toBe(GROUP_HEX);
  });

  it('passes a string group id through, and tolerates snake_case', () => {
    const asString: SignedInvitation = {
      invitation: { group_id: GROUP_HEX },
      inviter_signature: 'b'.repeat(128),
    };
    expect(namespaceIdOfInvite(asString)).toBe(GROUP_HEX);
  });

  it('ignores a wrapper that disagrees with the signature', () => {
    // A tampered code must not be able to redirect a join: the id acted on comes
    // from inside the signed blob, and the wrapper's claim is decoration.
    const tampered: SheetsInvitePayload = { ...PAYLOAD, groupId: 'f'.repeat(64) };
    expect(namespaceIdOfInvite(tampered)).toBe(GROUP_HEX);
  });

  it('is empty when the invitation names no group', () => {
    expect(
      namespaceIdOfInvite({ invitation: {}, inviterSignature: 'c' }),
    ).toBe('');
  });
});
