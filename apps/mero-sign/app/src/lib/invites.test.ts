// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRoutes } from '@calimero-apps/connect/testing';

import {
  captureInvite,
  dropInvite,
  inviteLink,
  inviteToken,
  joinedOrg,
  migrateLegacyInvite,
  pendingInvite,
} from './invites';

beforeEach(() => {
  localStorage.clear();
  dropInvite();
  window.history.replaceState(null, '', '/');
});

describe('invitations', () => {
  it('are org invites to the workspace, as a member, approved with a passkey', async () => {
    const invite = vi.fn(async () => 'tok');
    const passkey = { create: vi.fn(), get: vi.fn() };
    expect(await inviteToken(withRoutes({ invite }) as never, 'org-1', passkey)).toBe('tok');
    expect(invite).toHaveBeenCalledWith('org-1', 'member', expect.objectContaining({ confirm: expect.any(Function) }));
  });

  it('travel as this frontend’s own URL at its root, naming the agreement when there is one', () => {
    const loc = { href: 'http://localhost:5173/agreements/a1' };
    expect(inviteLink('tok', 'a1', loc)).toBe('http://localhost:5173/?invite=tok&agreement=a1');
    expect(inviteLink('tok', null, loc)).toBe('http://localhost:5173/?invite=tok');
    // Naming the workspace lets a member who opens it be told so, not spend it.
    expect(inviteLink('tok', null, loc, 'org-1')).toBe('http://localhost:5173/?invite=tok&org=org-1');
    // Where a node serves the app, under its `/{version}/` root.
    const served = `https://${'a'.repeat(52)}.apps.calimero.network`;
    expect(inviteLink('tok', 'a1', { href: `${served}/1.0.0/agreements/a1` })).toBe(
      `${served}/1.0.0/?invite=tok&agreement=a1`,
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

  it('name the org they joined, whichever field the node used', () => {
    expect(joinedOrg({ org: 'o1' })).toBe('o1');
    expect(joinedOrg({ orgId: 'o2' })).toBe('o2');
    expect(joinedOrg({})).toBeNull();
  });
});
