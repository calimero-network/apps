import { describe, it, expect } from 'vitest';
import {
  buildInviteUrl,
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
