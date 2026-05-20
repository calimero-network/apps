import { describe, it, expect } from 'vitest';
import {
  buildInviteUrl,
  extractInviteParams,
  parseInviteUrl,
  type ParsedInvite,
} from '../useNamespaceInvitation';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-react';

// The namespace display name rides the invite URL (`&name=`) so a
// joined node can show it immediately — `listNamespacesForApplication`
// omits the name until the node syncs the namespace root metadata.
// `buildInviteUrl` only JSON-stringifies the invitation, so an empty
// object round-trips fine for these URL-shape assertions.
const INV = {} as SignedGroupOpenInvitation;

describe('namespace invite — name on the URL', () => {
  it('appends the name param, percent-encoded, when provided', () => {
    const url = buildInviteUrl('http://x', 'namespace', 'ns1', INV, 'My Space');
    expect(url).toContain('&name=My%20Space');
  });

  it('omits the name param when no name is provided', () => {
    const url = buildInviteUrl('http://x', 'namespace', 'ns1', INV);
    expect(url).not.toContain('name=');
  });

  it('round-trips the namespace name through parseInviteUrl', () => {
    const url = buildInviteUrl('http://x', 'namespace', 'ns1', INV, 'My Space');
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).namespaceName).toBe('My Space');
  });

  it('leaves namespaceName undefined when the invite carries no name', () => {
    const url = buildInviteUrl('http://x', 'namespace', 'ns1', INV);
    const parsed = parseInviteUrl(new URL(url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).namespaceName).toBeUndefined();
  });
});

describe('extractInviteParams', () => {
  const canonical = buildInviteUrl(
    'https://mero-drive.vercel.app',
    'namespace',
    'ns-1',
    INV,
    'Test',
  );

  it('extracts params from a canonical production URL', () => {
    const params = extractInviteParams(canonical);
    expect(params).not.toBeNull();
    expect(params!.get('kind')).toBe('namespace');
    expect(params!.get('id')).toBe('ns-1');
    expect(params!.has('invite')).toBe(true);
  });

  it('extracts params from a URL on a different host (old deployment)', () => {
    const old = buildInviteUrl(
      'https://mero-drive-ey3c.vercel.app',
      'namespace',
      'ns-2',
      INV,
    );
    const params = extractInviteParams(old);
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-2');
  });

  it('extracts params from a localhost dev URL', () => {
    const local = buildInviteUrl(
      'http://localhost:5173',
      'group',
      'g-1',
      INV,
    );
    const params = extractInviteParams(local);
    expect(params).not.toBeNull();
    expect(params!.get('kind')).toBe('group');
  });

  it('extracts params from a bare query string with a leading ?', () => {
    const params = extractInviteParams(
      '?kind=namespace&id=ns-3&invite=eyJ0ZXN0Ijp0cnVlfQ',
    );
    expect(params).not.toBeNull();
    expect(params!.get('id')).toBe('ns-3');
  });

  it('extracts params from a bare query string without a leading ?', () => {
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
    // Just the `invite` value without `invite=` and the other required
    // params is not enough — parseInviteUrl needs `id` and `kind` too.
    expect(extractInviteParams('eyJpbnZpdGF0aW9uIjp7fX0')).toBeNull();
  });

  it('round-trips through parseInviteUrl', () => {
    const params = extractInviteParams(canonical);
    const parsed = parseInviteUrl(params!);
    expect('error' in parsed).toBe(false);
    expect((parsed as ParsedInvite).targetId).toBe('ns-1');
    expect((parsed as ParsedInvite).namespaceName).toBe('Test');
  });
});
