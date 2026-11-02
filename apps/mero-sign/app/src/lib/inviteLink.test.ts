import { describe, expect, it, vi } from 'vitest';

import { captureInvite, dropInvite, invitationUrl, pendingInvite } from './inviteLink';

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('invitation links', () => {
  it('carry the token and the agreement hint', () => {
    const url = invitationUrl('tok 1', 'app-1', { origin: 'https://sign.example', pathname: '/1.0.0/' });
    expect(url).toBe('https://sign.example/1.0.0/?invite=tok+1&agreement=app-1');
    expect(() => invitationUrl(' ')).toThrow();
  });

  it('are captured off the address bar before sign-in, and kept until dropped', () => {
    const storage = memory();
    const replace = vi.fn();
    const got = captureInvite(storage, { href: 'https://sign.example/?invite=tok&agreement=app-1&x=1' }, replace);
    expect(got).toEqual({ token: 'tok', agreement: 'app-1' });
    expect(replace).toHaveBeenCalledWith('https://sign.example/?x=1');
    expect(pendingInvite(storage)).toEqual({ token: 'tok', agreement: 'app-1' });
    dropInvite(storage);
    expect(pendingInvite(storage)).toBeNull();
  });

  it('leave a page without one alone', () => {
    const replace = vi.fn();
    expect(captureInvite(memory(), { href: 'https://sign.example/agreements' }, replace)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
