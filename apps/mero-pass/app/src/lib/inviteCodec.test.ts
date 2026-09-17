import { describe, expect, it } from 'vitest';

import {
  decodeInvite,
  encodeInvite,
  groupIdOfInvite,
  type PassInvitePayload,
  type SignedInvitation,
} from './inviteCodec';

/** A signed invitation shaped like the admin API's, with a byte-array group id. */
function signed(groupId: number[]): SignedInvitation {
  return {
    invitation: { groupId, inviteeCapabilities: 15 },
    inviterSignature: 'c0ffee',
  };
}

const GROUP_BYTES = [0x3f, 0x8a, 0x91, 0xc2];
const GROUP_HEX = '3f8a91c2';

describe('encodeInvite / decodeInvite', () => {
  it('round-trips a space invitation', () => {
    const payload: PassInvitePayload = {
      invitation: signed(GROUP_BYTES),
      kind: 'namespace',
      groupAlias: 'Acme Ltd',
      groupId: GROUP_HEX,
    };
    const decoded = decodeInvite(encodeInvite(payload));
    expect(decoded).not.toBeNull();
    expect(decoded!.kind).toBe('namespace');
    expect(decoded!.groupAlias).toBe('Acme Ltd');
    expect(decoded!.groupId).toBe(GROUP_HEX);
  });

  it('round-trips a vault invitation with its routing hints', () => {
    const payload: PassInvitePayload = {
      invitation: signed(GROUP_BYTES),
      kind: 'vault',
      groupId: GROUP_HEX,
      vaultId: 'vault-1',
      vaultName: 'Bank logins',
      contextId: 'ctx-1',
      groupAlias: 'Acme Ltd',
    };
    const decoded = decodeInvite(encodeInvite(payload))!;
    expect(decoded.kind).toBe('vault');
    expect(decoded.vaultId).toBe('vault-1');
    expect(decoded.vaultName).toBe('Bank logins');
    expect(decoded.contextId).toBe('ctx-1');
  });

  it('produces a code with no characters that break on copy', () => {
    const code = encodeInvite({ invitation: signed(GROUP_BYTES) });
    // Base58 rather than base64 exists precisely so `+`, `/`, `=` and
    // whitespace never appear — those are what URL encoders and chat clients
    // mangle, and an invite code's whole life is being pasted.
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('reads a code minted by a sibling app that spells the subgroup `room`', () => {
    // mero-stream and mero-meet use the same wire format with `roomId` /
    // `roomName`. Their namespace grant is valid here, and honouring their
    // spelling is what makes a cross-app code land on a subgroup rather than
    // dumping the joiner at the top of a space.
    const json = JSON.stringify({
      invitation: signed(GROUP_BYTES),
      kind: 'room',
      roomId: 'sub-1',
      roomName: 'Ops',
    });
    const decoded = decodeInvite(json)!;
    expect(decoded.kind).toBe('vault');
    expect(decoded.vaultId).toBe('sub-1');
    expect(decoded.vaultName).toBe('Ops');
  });

  it('accepts a bare signed invitation and an admin-api envelope', () => {
    expect(decodeInvite(JSON.stringify(signed(GROUP_BYTES)))).not.toBeNull();
    expect(
      decodeInvite(
        JSON.stringify({ data: { invitation: signed(GROUP_BYTES) } }),
      ),
    ).not.toBeNull();
  });

  it('returns null rather than throwing on anything unusable', () => {
    // Every caller of this is handling user input and wants "that code is not
    // valid", never an exception that takes the page down.
    for (const bad of ['', '   ', 'not-a-code', '{', '{}', '0OIl', '{"a":1}']) {
      expect(decodeInvite(bad)).toBeNull();
    }
  });

  it('drops a malformed chain entry but keeps the invitation', () => {
    const json = JSON.stringify({
      invitation: signed(GROUP_BYTES),
      chain: [{ groupId: '', invitation: null }, 'nonsense'],
    });
    const decoded = decodeInvite(json)!;
    expect(decoded.chain).toBeUndefined();
    expect(decoded.invitation).toBeTruthy();
  });

  it('keeps a well-formed chain, defaulting a non-root entry to `vault`', () => {
    const json = JSON.stringify({
      invitation: signed(GROUP_BYTES),
      chain: [
        { groupId: 'ns', invitation: signed(GROUP_BYTES), kind: 'namespace' },
        { groupId: 'sub', invitation: signed(GROUP_BYTES) },
      ],
    });
    const decoded = decodeInvite(json)!;
    expect(decoded.chain).toHaveLength(2);
    expect(decoded.chain![0].kind).toBe('namespace');
    // Defaulting the other way round is the dangerous one: joinNamespace on a
    // subgroup can look like it succeeded against the parent and leave the
    // joiner outside the vault they were invited to.
    expect(decoded.chain![1].kind).toBe('vault');
  });
});

describe('groupIdOfInvite', () => {
  it('hex-encodes a byte-array group id', () => {
    expect(groupIdOfInvite(signed(GROUP_BYTES))).toBe(GROUP_HEX);
  });

  it('accepts the snake_case spelling and a string id', () => {
    expect(
      groupIdOfInvite({
        invitation: { group_id: GROUP_BYTES },
        inviter_signature: 'c0ffee',
      }),
    ).toBe(GROUP_HEX);
    expect(
      groupIdOfInvite({
        invitation: { groupId: 'already-a-string' },
        inviterSignature: 'c0ffee',
      }),
    ).toBe('already-a-string');
  });

  it('reads the id from INSIDE the signature, not from the wrapper', () => {
    // The wrapper is unsigned, so a tampered `groupId` beside the invitation
    // must not be able to redirect a join.
    const payload: PassInvitePayload = {
      invitation: signed(GROUP_BYTES),
      groupId: 'deadbeef',
    };
    expect(groupIdOfInvite(payload)).toBe(GROUP_HEX);
  });

  it('returns an empty string when there is no id at all', () => {
    expect(
      groupIdOfInvite({ invitation: {}, inviterSignature: 'c0ffee' }),
    ).toBe('');
  });
});

describe('the payload carries no secret', () => {
  it('serialises only the grant and its routing hints', () => {
    // This app holds passwords. The guard is structural: assert the exact KEY
    // SET that reaches the wire, so a field added later has to be added here
    // too — which is the moment somebody asks whether it should be shared.
    const payload: PassInvitePayload = {
      invitation: signed(GROUP_BYTES),
      kind: 'vault',
      groupId: GROUP_HEX,
      groupAlias: 'Acme Ltd',
      vaultId: 'vault-1',
      vaultName: 'Bank logins',
      contextId: 'ctx-1',
    };
    const decoded = decodeInvite(encodeInvite(payload))!;
    expect(new Set(Object.keys(decoded))).toEqual(
      new Set([
        'invitation',
        'kind',
        'groupId',
        'groupAlias',
        'vaultId',
        'vaultName',
        'contextId',
        'chain',
      ]),
    );
  });
});
