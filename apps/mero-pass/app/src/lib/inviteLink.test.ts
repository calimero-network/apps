import { beforeEach, describe, expect, it } from 'vitest';

import {
  invitationFromRaw,
  invitationUrl,
  invites,
  migrateLegacyInvite,
} from './inviteLink';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => {
  localStorage.clear();
  invites.drop();
});

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
    invites.capture(window.location);
    expect(invites.token()).toBe('tok');
    expect(window.location.search).toBe('?x=1');
    invites.drop();
    expect(invites.token()).toBeNull();
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
    invites.capture(window.location);
    expect(invites.pending()?.org).toBe('org1');
    expect(window.location.search).toBe('');
    invites.drop();
    expect(invites.pending()).toBeNull();
  });

  it('moves an invite an earlier build stored under its own keys into the shared store', () => {
    const storage = memory();
    storage.setItem('mero-pass:pending-invite', 'old');
    storage.setItem('mero-pass:pending-invite-org', 'org1');
    migrateLegacyInvite(storage);
    expect(invites.token()).toBe('old');
    expect(invites.pending()?.org).toBe('org1');
    expect(storage.getItem('mero-pass:pending-invite')).toBeNull();
  });
});
