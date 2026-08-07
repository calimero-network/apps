import { describe, it, expect, vi } from 'vitest';
import {
  buildInviteUrl,
  classifyJoinError,
  extractInviteParams,
  inviteExpiryMs,
  isInviteExpired,
  parseInviteUrl,
  type ParsedInvite,
} from '../useNamespaceInvitation';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-react';

// Pin the package so the canonical deep-link shape is asserted
// deterministically (vitest may or may not load .env.local).
vi.mock('@/constants/config', () => ({
  PACKAGE_NAME: 'com.calimero.mero-drive-docs',
  DEEP_LINK_BASE: 'https://links.calimero.network',
}));

// The namespace display name rides the invite URL (`&name=`) so a
// joined node can show it immediately — `listNamespacesForApplication`
// omits the name until the node syncs the namespace root metadata.
// `buildInviteUrl` only JSON-stringifies the invitation, so an empty
// object round-trips fine for these URL-shape assertions.
const INV = {} as SignedGroupOpenInvitation;

describe('buildInviteUrl — canonical deep link', () => {
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

  it('appends the name param, percent-encoded, when provided', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV, 'My Space');
    expect(url).toContain('&name=My%20Space');
  });

  it('omits the name param when no name is provided', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV);
    expect(url).not.toContain('name=');
  });

  it('round-trips the namespace name through parseInviteUrl', () => {
    const url = buildInviteUrl('namespace', 'ns1', INV, 'My Space');
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).namespaceName).toBe('My Space');
  });
});

describe('extractInviteParams', () => {
  const canonical = buildInviteUrl('namespace', 'ns-1', INV, 'Test');

  it('extracts params from a canonical deep link', () => {
    const params = extractInviteParams(canonical);
    expect(params).not.toBeNull();
    expect(params!.get('kind')).toBe('namespace');
    expect(params!.get('id')).toBe('ns-1');
    expect(params!.has('invitation')).toBe(true);
  });

  it('extracts params from a legacy invite= URL (links in the wild)', () => {
    const legacy =
      'https://mero-drive.vercel.app/join?kind=namespace&id=ns-legacy&invite=eyJ0ZXN0Ijp0cnVlfQ';
    const params = extractInviteParams(legacy);
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-legacy');
  });

  it('extracts params from a bare query string with a leading ?', () => {
    const params = extractInviteParams(
      '?kind=namespace&id=ns-3&invitation=eyJ0ZXN0Ijp0cnVlfQ',
    );
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-3');
  });

  it('extracts params from a bare legacy query string without a leading ?', () => {
    const params = extractInviteParams(
      'kind=namespace&id=ns-4&invite=eyJ0ZXN0Ijp0cnVlfQ',
    );
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-4');
  });

  it('tolerates surrounding whitespace and newlines', () => {
    const padded = `  \n  ${canonical}  \n`;
    const params = extractInviteParams(padded);
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-1');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(extractInviteParams('')).toBeNull();
    expect(extractInviteParams('   \n  ')).toBeNull();
  });

  it('returns null for a URL that has no invite param', () => {
    expect(
      extractInviteParams('https://mero-drive.vercel.app/app?foo=bar'),
    ).toBeNull();
  });

  it('returns null for a raw base64 payload (no surrounding params)', () => {
    // Just the payload value without `invitation=` and the other
    // required params is not enough — parseInviteUrl needs `id` too.
    expect(extractInviteParams('eyJpbnZpdGF0aW9uIjp7fX0')).toBeNull();
  });

  it('round-trips through parseInviteUrl', () => {
    const params = extractInviteParams(canonical);
    const parsed = parseInviteUrl(params!);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).targetId).toBe('ns-1');
    expect((parsed as ParsedInvite).namespaceName).toBe('Test');
  });

  it('parses a legacy invite= payload through parseInviteUrl', () => {
    const params = extractInviteParams(
      '?kind=group&id=g-1&invite=eyJ0ZXN0Ijp0cnVlfQ',
    );
    const parsed = parseInviteUrl(params!);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).kind).toBe('group');
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

  const withExpiry = (ts: number) =>
    ({ invitation: { expirationTimestamp: ts } }) as SignedGroupOpenInvitation;

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
});

describe('classifyJoinError', () => {
  // Every phrasing raised in review, including the ones that must NOT match:
  // a confidently wrong card hides the real server error from the user.
  const cases: Array<[string, 'already-member' | 'expired' | 'unknown']> = [
    ['identity is already a member of this group', 'already-member'],
    ['Already joined', 'already-member'],
    ['caller already in the namespace', 'already-member'],
    ['this item is already in the trash', 'unknown'],
    ['request is already in the queue', 'unknown'],
    ['this account was already removed from the member list', 'unknown'],
    ['folder is already at member capacity', 'unknown'],
    ['Invitation validation failed. Reason: expired.', 'expired'],
    ['Invite rejected. It expired yesterday.', 'expired'],
    ['this invite link has expired', 'expired'],
    ['invitation expired', 'expired'],
    ['The upload link for this document has expired', 'unknown'],
    ['your session token expired', 'unknown'],
    ['HTTP 500 Internal Server Error', 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('classifies %j as %s', (message, expected) => {
    expect(classifyJoinError(message)).toBe(expected);
  });
});
