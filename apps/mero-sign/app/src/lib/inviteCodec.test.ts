import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import {
  contextIdOfInvite,
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  type SignedOpenInvitationLike,
} from './inviteCodec';

const CONTEXT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function signed(contextId: unknown = CONTEXT_ID): SignedOpenInvitationLike {
  return {
    invitation: {
      contextId,
      inviterIdentity: '11'.repeat(32),
      expirationHeight: 4242,
      protocol: 'near',
      network: 'testnet',
      contractId: 'calimero.testnet',
    },
    inviterSignature: 'ff'.repeat(64),
  };
}

describe('encodeInvite / decodeInvite', () => {
  it('round-trips an open invitation with its name hint', () => {
    const code = encodeInvite({
      invitation: signed(),
      contextId: CONTEXT_ID,
      contextName: 'NDA with Acme',
    });
    const decoded = decodeInvite(code);

    expect(decoded?.kind).toBe('open');
    expect(decoded?.contextName).toBe('NDA with Acme');
    expect(decoded?.contextId).toBe(CONTEXT_ID);
    expect(decoded?.invitation).toEqual(signed());
  });

  it('produces a code with no character that breaks a copy-paste', () => {
    const code = encodeInvite({ invitation: signed() });
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('is dramatically shorter than the percent-escaped JSON it replaces', () => {
    const payload = { invitation: signed(), contextName: 'NDA with Acme' };
    const legacy = encodeURIComponent(JSON.stringify(payload));
    expect(encodeInvite(payload).length).toBeLessThan(legacy.length / 2);
  });

  it('accepts a bare SignedOpenInvitation, as returned by the admin API', () => {
    const decoded = decodeInvite(JSON.stringify(signed()));
    expect(decoded?.kind).toBe('open');
    expect(decoded?.invitation).toEqual(signed());
    expect(decoded?.contextName).toBeUndefined();
  });

  // The regression that made every shared invitation unredeemable: the node
  // answers `{"data": {…}}`, the minting screen stringified the envelope, and
  // the joining screen posted it as the `invitation` field — which every core
  // request body rejects, because they are all `deny_unknown_fields`.
  it('peels the admin-api {data: …} envelope', () => {
    const decoded = decodeInvite(JSON.stringify({ data: signed() }));
    expect(decoded?.kind).toBe('open');
    expect(decoded?.invitation).toEqual(signed());
  });

  it('peels the envelope around a wrapped payload too', () => {
    const decoded = decodeInvite(
      JSON.stringify({ invitation: { data: signed() }, contextName: 'Lease' }),
    );
    expect(decoded?.invitation).toEqual(signed());
    expect(decoded?.contextName).toBe('Lease');
  });

  it('reads an uncompressed base58 payload, as other mero apps mint it', () => {
    const json = JSON.stringify({
      invitation: signed(),
      groupAlias: 'Series A',
    });
    const code = bs58.encode(new TextEncoder().encode(json));
    const decoded = decodeInvite(code);
    expect(decoded?.kind).toBe('open');
    expect(decoded?.contextName).toBe('Series A');
  });

  it('treats an unrecognised long payload as a targeted invitation', () => {
    const opaque = 'z'.repeat(120);
    const decoded = decodeInvite(opaque);
    expect(decoded?.kind).toBe('targeted');
    expect(decoded?.targetedPayload).toBe(opaque);
    expect(decoded?.invitation).toBeUndefined();
  });

  it('rejects empty and obviously-too-short input', () => {
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('   ')).toBeNull();
    expect(decodeInvite('hello')).toBeNull();
  });

  it('rejects JSON that is not an invitation', () => {
    expect(decodeInvite('{"hello":"world"}')).toBeNull();
    // An `invitation` with no signature is not one.
    expect(decodeInvite('{"invitation":{"contextId":"aa"}}')).toBeNull();
  });

  it('tolerates the snake_case signature spelling', () => {
    const snake = {
      invitation: { context_id: CONTEXT_ID },
      inviter_signature: 'ab'.repeat(64),
    };
    const decoded = decodeInvite(JSON.stringify(snake));
    expect(decoded?.kind).toBe('open');
    expect(contextIdOfInvite(decoded!)).toBe(CONTEXT_ID);
  });
});

describe('contextIdOfInvite', () => {
  it('reads the id out of the SIGNED body, not the wrapper beside it', () => {
    // A tampered wrapper must not be able to point a join somewhere else.
    const code = encodeInvite({
      invitation: signed(CONTEXT_ID),
      contextId: 'deadbeef'.repeat(4),
    });
    const decoded = decodeInvite(code)!;
    expect(decoded.contextId).toBe('deadbeef'.repeat(4));
    expect(contextIdOfInvite(decoded)).toBe(CONTEXT_ID);
  });

  it('hex-encodes a byte-array context id', () => {
    const decoded = decodeInvite(
      JSON.stringify(signed([0x0a, 0xff, 0x00, 0x10])),
    )!;
    expect(contextIdOfInvite(decoded)).toBe('0aff0010');
  });

  it('returns an empty string when the invitation names no context', () => {
    const decoded = decodeInvite(
      JSON.stringify({ invitation: {}, inviterSignature: 'aa' }),
    )!;
    expect(contextIdOfInvite(decoded)).toBe('');
  });
});

// ── The workspace an invitation grants ──────────────────────────────────────
//
// `joinNamespace` takes the namespace in the PATH, so the join flow cannot
// proceed without it — and it must come from the signed body, because a
// namespace id read from the envelope beside the signature is a namespace id
// a sharer could edit to put a joiner somewhere else. Core spells it
// `group_id` in the signed invitation: a namespace IS a root group.

const NAMESPACE_ID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

function signedWithGroup(groupId: unknown): SignedOpenInvitationLike {
  return {
    invitation: {
      group_id: groupId,
      inviter_identity: '11'.repeat(32),
      expiration_timestamp: 4242,
      secret_salt: [1, 2, 3],
      invited_role: 0,
    },
    inviter_signature: 'ff'.repeat(64),
  };
}

describe('namespaceIdOfInvite', () => {
  it('reads group_id out of the signed body', () => {
    expect(namespaceIdOfInvite(signedWithGroup(NAMESPACE_ID))).toBe(
      NAMESPACE_ID,
    );
  });

  it('hex-encodes the byte-array spelling core actually ships', () => {
    const bytes = [0x0f, 0x1e, 0x2d, 0x3c];
    expect(namespaceIdOfInvite(signedWithGroup(bytes))).toBe('0f1e2d3c');
  });

  it('survives a round trip through the shareable code', () => {
    const code = encodeInvite({
      invitation: signedWithGroup(NAMESPACE_ID),
      workspaceName: 'Acme',
    });
    const decoded = decodeInvite(code);
    expect(decoded).not.toBeNull();
    expect(decoded?.workspaceName).toBe('Acme');
    expect(namespaceIdOfInvite(decoded!)).toBe(NAMESPACE_ID);
  });

  it('IGNORES a namespace id planted in the envelope', () => {
    // The whole point. If the envelope could name the namespace, editing a
    // shared link would redirect a joiner into a workspace the invitation
    // never granted.
    const code = encodeInvite({
      invitation: signedWithGroup(NAMESPACE_ID),
      workspaceName: 'Acme',
    });
    const decoded = decodeInvite(code)!;
    (decoded as unknown as Record<string, unknown>).namespaceId = 'ff'.repeat(
      16,
    );
    expect(namespaceIdOfInvite(decoded)).toBe(NAMESPACE_ID);
  });

  it('is empty for an invitation with no group in it, rather than guessing', () => {
    // An older, context-era invitation. The caller turns this into "ask for a
    // new link", which is true and actionable.
    expect(namespaceIdOfInvite(signed())).toBe('');
  });
});
