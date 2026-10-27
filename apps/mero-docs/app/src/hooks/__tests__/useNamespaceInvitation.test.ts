import { describe, it, expect, vi } from 'vitest';
import {
  buildInviteUrl,
  inviteExpiryMs,
  isInviteExpired,
  parseInviteUrl,
  type ParsedInvite,
} from '../useNamespaceInvitation';
import type { SignedGroupOpenInvitation } from '@calimero-apps/cloud';

// Pin the package so the canonical deep-link shape is asserted
// deterministically (vitest may or may not load .env.local).
vi.mock('@/constants/config', () => ({
  PACKAGE_NAME: 'com.calimero.mero-drive-docs',
}));

// The namespace display name rides the invite URL (`&name=`) so a
// joined node can show it immediately - `listNamespacesForApplication`
// omits the name until the node syncs the namespace root metadata.
// `buildInviteUrl` only JSON-stringifies the invitation, so an empty
// object round-trips fine for these URL-shape assertions.
const INV = {} as SignedGroupOpenInvitation;

describe('buildInviteUrl - canonical deep link', () => {
  it('builds on links.calimero.network with the package as the slug', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV);
    expect(url).toMatch(
      /^https:\/\/links\.calimero\.network\/com\.calimero\.mero-drive-docs\/join\?invitation=/,
    );
  });

  it('carries kind and id as sibling params', () => {
    const url = buildInviteUrl('group', 'g-9', INV);
    const params = new URL(url).searchParams;
    expect(params.get('kind')).toBe('group');
    expect(params.get('id')).toBe('g-9');
    expect(params.get('invitation')).toBeTruthy();
  });

  it('appends the name param, encoded, when provided', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV, 'My Space');
    expect(new URL(url).searchParams.get('name')).toBe('My Space');
  });

  it('omits the name param when no name is provided', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV);
    expect(url).not.toContain('name=');
  });

  it('round-trips the namespace name through parseInviteUrl', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV, 'My Space');
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).targetName).toBe('My Space');
  });

  // A folder invite is the one whose recipient can least identify the target
  // by id - the folder may be restricted, so the id is all they would see.
  it('round-trips a FOLDER name through parseInviteUrl', () => {
    const url = buildInviteUrl('group', 'g-7', INV, 'Q3 Budget');
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).kind).toBe('group');
    expect((parsed as ParsedInvite).targetName).toBe('Q3 Budget');
  });

  // `&`/`#`/`=` in a workspace name would otherwise truncate the link into
  // something that fails at the joiner rather than at build time.
  it('survives a name containing URL-significant characters', () => {
    const name = 'R&D #2 = fun';
    const url = buildInviteUrl('namespace', 'ns1', INV, name);
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect((parsed as ParsedInvite).targetName).toBe(name);
    expect((parsed as ParsedInvite).targetId).toBe('ns1');
  });
});

// Links already shared keep working: they arrive through the shared capture
// as plain query params, in whichever shape they were minted.
describe('parseInviteUrl - links already out there', () => {
  const canonical = buildInviteUrl('namespace', 'ns-1', INV, 'Test');
  const payload = new URL(canonical).searchParams.get('invitation')!;

  it('reads the legacy invite= payload and ns= id', () => {
    const parsed = parseInviteUrl(
      new URLSearchParams(`invite=${payload}&ns=ns-1`),
    );
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).kind).toBe('namespace');
    expect((parsed as ParsedInvite).targetId).toBe('ns-1');
  });

  it('falls back to the group the signed invitation names when id is absent', () => {
    const signed = buildInviteUrl('namespace', 'x', {
      invitation: { group_id: [0xab, 0x01, 0xff] },
    } as unknown as SignedGroupOpenInvitation);
    const token = new URL(signed).searchParams.get('invitation')!;
    const parsed = parseInviteUrl(new URLSearchParams(`invitation=${token}`));
    expect((parsed as ParsedInvite).targetId).toBe('ab01ff');
  });

  it('reports a link with neither an id nor a group in the invitation', () => {
    const parsed = parseInviteUrl(new URLSearchParams(`invitation=${payload}`));
    expect(parsed).toEqual({ error: 'Missing target id in invite link.' });
  });

  it('reports a truncated payload instead of throwing', () => {
    const parsed = parseInviteUrl(
      new URLSearchParams('invitation=%%%&kind=namespace&id=ns-1'),
    );
    expect('error' in parsed && parsed.error).toMatch(/could not be decoded/);
  });
});

describe('invite expiry', () => {
  const NOW = Date.now();

  it('normalizes seconds, milliseconds, and nanoseconds to ms', () => {
    const t = 1_754_400_000; // an epoch in seconds
    expect(inviteExpiryMs(t)).toBe(t * 1000);
    expect(inviteExpiryMs(t * 1000)).toBe(t * 1000);
    expect(inviteExpiryMs(t * 1e9)).toBe(t * 1000);
  });

  // ⚠️ `expiration_timestamp`, not `expirationTimestamp`.
  // `GroupInvitationFromAdmin` mirrors a core PRIMITIVE, which carries no
  // camelCase rename - unlike every admin DTO around it. This fixture used the
  // camelCase spelling and so did the code, so the pair agreed with each other
  // and with nothing core has ever put on the wire: `isInviteExpired` returned
  // `false` for every real invitation. A hand-written fixture cannot catch that
  // on its own, which is why the snake_case name is now the one under test and
  // the camelCase tolerance is asserted separately, as tolerance.
  const withExpiry = (ts: number) =>
    ({
      invitation: { expiration_timestamp: ts },
    }) as unknown as SignedGroupOpenInvitation;

  it('flags a past timestamp as expired in any unit', () => {
    const past = Math.floor(NOW / 1000) - 3600; // one hour ago, seconds
    expect(isInviteExpired(withExpiry(past))).toBe(true);
    expect(isInviteExpired(withExpiry(past * 1000))).toBe(true);
    expect(isInviteExpired(withExpiry(past * 1e9))).toBe(true);
  });

  it('accepts a future timestamp', () => {
    const future = Math.floor(NOW / 1000) + 3600;
    expect(isInviteExpired(withExpiry(future))).toBe(false);
  });

  it('never expires when the timestamp is missing or zero', () => {
    expect(isInviteExpired(withExpiry(0))).toBe(false);
    expect(isInviteExpired({} as SignedGroupOpenInvitation)).toBe(false);
  });

  it('reads the snake_case wire key core actually sends', () => {
    const past = Math.floor(NOW / 1000) - 3600;
    const wire = {
      invitation: { expiration_timestamp: past },
    } as unknown as SignedGroupOpenInvitation;
    expect(isInviteExpired(wire)).toBe(true);
  });

  it('still tolerates a camelCase timestamp', () => {
    const past = Math.floor(NOW / 1000) - 3600;
    const renamed = {
      invitation: { expirationTimestamp: past },
    } as unknown as SignedGroupOpenInvitation;
    expect(isInviteExpired(renamed)).toBe(true);
  });
});
