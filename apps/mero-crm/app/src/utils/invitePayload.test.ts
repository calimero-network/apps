/**
 * Pins the invitation PAYLOAD — the part that carries the workspace name across
 * nodes, and the part that has to cross-decode with the other mero apps.
 *
 * Every test here corresponds to something that was silently broken:
 * `groupAlias` read off a field the wire spells `groupName`, a group id read as
 * `groupId` when the signed body spells it `group_id` and sends BYTES, and an
 * envelope no other app in the ecosystem could parse.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInvitePayload,
  groupIdOfInvite,
  isSignedInvitation,
  parseInvitePayload,
} from './invitePayload';
import {
  APP_SLUG,
  decodeInvitation,
  encodeInvitation,
  generateInvitationDeepLink,
  generateInvitationUrl,
  parseInvitationInput,
} from './invitation';

const bytes = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => (i * 37 + seed * 101) % 256);

const NS_ID = '20150f8a24c5cd0569743966240da01966b91d85e1c1e3a535ba3de98b864f59';
const NS_BYTES = NS_ID.match(/../g)!.map((h) => parseInt(h, 16));

/** What a node returns from POST /admin-api/namespaces/:id/invite. */
const SIGNED = {
  invitation: {
    inviter_identity: bytes(32, 1),
    group_id: NS_BYTES,
    expiration_timestamp: 1786000000000,
    secret_salt: bytes(16, 2),
    invited_role: 1,
    admitters: ['aa'.repeat(32)],
  },
  inviter_signature: 'ab'.repeat(64),
};

describe('isSignedInvitation', () => {
  it('accepts either signature spelling and rejects a bare body', () => {
    expect(isSignedInvitation(SIGNED)).toBe(true);
    expect(isSignedInvitation({ invitation: {}, inviterSignature: 'x' })).toBe(true);
    expect(isSignedInvitation({ invitation: {} })).toBe(false);
    expect(isSignedInvitation(null)).toBe(false);
    expect(isSignedInvitation('nope')).toBe(false);
  });
});

describe('groupIdOfInvite', () => {
  it('hex-encodes the BYTE ARRAY the signed body actually carries', () => {
    // The old join path read `parsed.invitation.groupId` — camelCase, and a
    // string. Both wrong, so it always fell through to "cannot determine
    // namespace" for a non-recursive invitation.
    expect(groupIdOfInvite(SIGNED)).toBe(NS_ID);
  });

  it('accepts a payload wrapper as well as a bare signed invitation', () => {
    expect(groupIdOfInvite({ invitation: SIGNED, groupAlias: 'Platform' })).toBe(NS_ID);
  });

  it('tolerates a node that already sends a string, and reports "" for neither', () => {
    expect(
      groupIdOfInvite({ invitation: { groupId: NS_ID }, inviter_signature: 's' }),
    ).toBe(NS_ID);
    expect(groupIdOfInvite({ invitation: {}, inviter_signature: 's' })).toBe('');
  });
});

describe('buildInvitePayload', () => {
  it('carries the workspace NAME the creator typed', () => {
    const payload = buildInvitePayload(
      { invitation: SIGNED },
      { namespaceId: NS_ID, namespaceName: 'Platform team' },
    );
    expect(payload).toEqual({
      invitation: SIGNED,
      kind: 'namespace',
      groupId: NS_ID,
      groupAlias: 'Platform team',
    });
  });

  it('falls back to the node’s echoed groupName when the caller has none', () => {
    const payload = buildInvitePayload({ invitation: SIGNED, groupName: 'Echoed' });
    expect(payload?.groupAlias).toBe('Echoed');
  });

  it('unwraps a recursive response, taking the OUTERMOST (namespace) entry', () => {
    const payload = buildInvitePayload({
      invitations: [
        { groupId: NS_ID, invitation: SIGNED, groupName: 'Platform team' },
        { groupId: 'ff'.repeat(32), invitation: SIGNED },
      ],
    });
    expect(payload?.groupId).toBe(NS_ID);
    expect(payload?.groupAlias).toBe('Platform team');
  });

  it('omits groupAlias entirely rather than emitting an empty one', () => {
    const payload = buildInvitePayload({ invitation: SIGNED }, { namespaceName: '  ' });
    expect(payload).not.toHaveProperty('groupAlias');
  });

  it('returns null when the node answered without a signature', () => {
    expect(buildInvitePayload({ invitation: { invitation: {} } })).toBeNull();
    expect(buildInvitePayload({ invitations: [] })).toBeNull();
    expect(buildInvitePayload(null)).toBeNull();
    expect(buildInvitePayload('nope')).toBeNull();
  });
});

describe('parseInvitePayload', () => {
  it('round-trips what buildInvitePayload produced, name intact', () => {
    const payload = buildInvitePayload(
      { invitation: SIGNED },
      { namespaceId: NS_ID, namespaceName: 'Platform team' },
    )!;
    const parsed = parseInvitePayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed?.groupAlias).toBe('Platform team');
    expect(groupIdOfInvite(parsed!)).toBe(NS_ID);
  });

  it('reads a mero-stream / mero-meet code — same keys, same meaning', () => {
    const fromStream = {
      invitation: SIGNED,
      kind: 'namespace',
      groupId: NS_ID,
      groupAlias: 'Design sync',
    };
    const parsed = parseInvitePayload(fromStream);
    expect(parsed?.groupAlias).toBe('Design sync');
    expect(groupIdOfInvite(parsed!)).toBe(NS_ID);
  });

  it('still reads this app’s OWN pre-fix recursive codes', () => {
    const parsed = parseInvitePayload({
      invitations: [{ groupId: NS_ID, invitation: SIGNED, groupName: 'Legacy' }],
    });
    expect(parsed?.groupAlias).toBe('Legacy');
    expect(groupIdOfInvite(parsed!)).toBe(NS_ID);
  });

  it('reads a bare admin-api response pasted raw, and a {data:…} envelope', () => {
    expect(groupIdOfInvite(parseInvitePayload(SIGNED)!)).toBe(NS_ID);
    expect(groupIdOfInvite(parseInvitePayload({ data: { invitation: SIGNED } })!)).toBe(
      NS_ID,
    );
  });

  it('returns null for anything that is not an invitation', () => {
    expect(parseInvitePayload({ hello: 'world' })).toBeNull();
    expect(parseInvitePayload(null)).toBeNull();
    expect(parseInvitePayload(42)).toBeNull();
  });
});

describe('end to end, through the link codec', () => {
  it('a minted payload survives encode → decode → parse with its name', () => {
    const payload = buildInvitePayload(
      { invitation: SIGNED },
      { namespaceId: NS_ID, namespaceName: 'Platform team' },
    )!;
    const parsed = parseInvitePayload(decodeInvitation(encodeInvitation(payload)));
    expect(parsed?.groupAlias).toBe('Platform team');
    expect(groupIdOfInvite(parsed!)).toBe(NS_ID);
  });

  it('is redeemable from the SHARE LINK, not merely from the bare code', () => {
    // The user-visible claim: what `InviteModal` copies is a URL, and pasting
    // that URL back into the join field has to reach the same namespace and the
    // same name. Both link forms carry the payload in a QUERY parameter — never
    // the hash, which belongs to the SSO callback.
    const payload = buildInvitePayload(
      { invitation: SIGNED },
      { namespaceId: NS_ID, namespaceName: 'Platform team' },
    )!;
    const json = JSON.stringify(payload);

    for (const link of [generateInvitationUrl(json), generateInvitationDeepLink(json)]) {
      expect(link).toContain(APP_SLUG);
      expect(link).toContain('?invitation=');
      expect(link).not.toContain('#');
      const parsed = parseInvitePayload(JSON.parse(parseInvitationInput(link)!));
      expect(parsed?.groupAlias).toBe('Platform team');
      expect(groupIdOfInvite(parsed!)).toBe(NS_ID);
    }
  });
});
