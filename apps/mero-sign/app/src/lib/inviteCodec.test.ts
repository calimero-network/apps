import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import {
  contextIdOfInvite,
  decodeInvite,
  encodeInvite,
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
