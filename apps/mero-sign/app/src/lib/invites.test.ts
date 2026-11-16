// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { captureInvite, dropInvite, inviteBase, migrateLegacyInvite, pendingInvite } from './invites';

beforeEach(() => {
  localStorage.clear();
  dropInvite();
  window.history.replaceState(null, '', '/');
});

describe('invitations', () => {
  it('open at this frontend’s root, naming the workspace and the agreement when there is one', () => {
    const loc = { href: 'http://localhost:5173/agreements/a1' };
    expect(inviteBase('org-1', 'a1', loc)).toBe('http://localhost:5173/?org=org-1&agreement=a1');
    // Naming the workspace lets a member who opens it be told so, not spend it.
    expect(inviteBase('org-1', null, loc)).toBe('http://localhost:5173/?org=org-1');
    // Where a node serves the app, under its `/{version}/` root.
    const served = `https://${'a'.repeat(52)}.apps.calimero.network`;
    expect(inviteBase('org-1', 'a1', { href: `${served}/1.0.0/agreements/a1` })).toBe(
      `${served}/1.0.0/?org=org-1&agreement=a1`,
    );
  });

  it('move an invite an earlier build stored under its own key into the shared store', () => {
    localStorage.setItem('mero-sign:pending-invite', JSON.stringify({ token: 'old', agreement: 'a1', org: 'o1' }));
    migrateLegacyInvite();
    expect(pendingInvite()).toEqual({ token: 'old', agreement: 'a1', org: 'o1' });
    expect(localStorage.getItem('mero-sign:pending-invite')).toBeNull();
  });

  it('are taken off the address bar before anything renders, and survive until dropped', () => {
    window.history.replaceState(null, '', '/?invite=tok&agreement=a1&x=1');
    captureInvite();
    expect(window.location.search).toBe('?x=1');
    expect(pendingInvite()).toEqual({ token: 'tok', agreement: 'a1', org: null });
    dropInvite();
    expect(pendingInvite()).toBeNull();
  });

  it('take the token off a shared-dialog link, which carries it in the fragment', () => {
    window.history.replaceState(null, '', '/?org=o1&agreement=a1#invite=tok');
    captureInvite();
    expect(pendingInvite()).toEqual({ token: 'tok', agreement: 'a1', org: 'o1' });
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('leave a page without an invite alone', () => {
    window.history.replaceState(null, '', '/x#other=1');
    captureInvite();
    expect(pendingInvite()).toBeNull();
    expect(window.location.hash).toBe('#other=1');
  });
});
