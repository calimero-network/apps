import { describe, expect, it } from 'vitest';

import {
  captureInvite,
  dropInvite,
  invitationFromRaw,
  invitationUrl,
  isSpentInvite,
  pendingInvite,
  pendingInviteOrg,
} from './inviteLink';
import { CalimeroError } from '@calimero-network/mero-js';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('invitation links', () => {
  it('carries the token in ?invite=, at the app root', () => {
    expect(
      invitationUrl('tok123', {
        origin: 'https://pass.example',
        pathname: '/teams/org1',
      }),
    ).toBe('https://pass.example/?invite=tok123');
    expect(
      invitationUrl('tok', {
        origin: 'https://n.example',
        pathname: '/1.2.0/vault/abc',
      }),
    ).toBe('https://n.example/1.2.0/?invite=tok');
    expect(() => invitationUrl('  ')).toThrow();
  });

  it('reads a pasted link or a bare token', () => {
    expect(invitationFromRaw('https://pass.example/?invite=abc')).toBe('abc');
    expect(invitationFromRaw('  abc-DEF_1  ')).toBe('abc-DEF_1');
    expect(invitationFromRaw('https://pass.example/teams')).toBeNull();
    expect(invitationFromRaw('not a token')).toBeNull();
    expect(invitationFromRaw('')).toBeNull();
  });

  it('keeps a captured token until it is dropped, and clears the address bar', () => {
    window.history.replaceState(null, '', '/teams?invite=tok&x=1');
    const storage = memory();
    captureInvite(storage, window.location);
    expect(pendingInvite(storage)).toBe('tok');
    expect(window.location.search).toBe('?x=1');
    dropInvite(storage);
    expect(pendingInvite(storage)).toBeNull();
  });

  it('names the team in ?org= and keeps it with the token until dropped', () => {
    expect(
      invitationUrl(
        'tok',
        { origin: 'https://pass.example', pathname: '/teams/org1' },
        'org1',
      ),
    ).toBe('https://pass.example/?invite=tok&org=org1');
    window.history.replaceState(null, '', '/?invite=tok&org=org1');
    const storage = memory();
    captureInvite(storage, window.location);
    expect(pendingInviteOrg(storage)).toBe('org1');
    expect(window.location.search).toBe('');
    dropInvite(storage);
    expect(pendingInviteOrg(storage)).toBeNull();
  });

  it('counts a 4xx redemption as a spent invite, and a 5xx or 401 as retryable', () => {
    expect(
      isSpentInvite(new CalimeroError(404, 'NOT_FOUND', 'unknown invite')),
    ).toBe(true);
    expect(isSpentInvite(new CalimeroError(401, 'UNAUTHENTICATED', 'x'))).toBe(
      false,
    );
    expect(isSpentInvite(new CalimeroError(503, 'UNAVAILABLE', 'x'))).toBe(
      false,
    );
    expect(isSpentInvite(new Error('offline'))).toBe(false);
  });
});
