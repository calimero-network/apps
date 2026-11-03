// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureInvite,
  dropInvite,
  inviteLink,
  inviteToken,
  joinedOrg,
  pendingInvite,
} from './invites';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('invitations', () => {
  it('are org invites to the workspace, as a member, approved with a passkey', async () => {
    const invite = vi.fn(async () => 'tok');
    const passkey = { create: vi.fn(), get: vi.fn() };
    expect(await inviteToken({ invite } as never, 'org-1', passkey)).toBe('tok');
    expect(invite).toHaveBeenCalledWith('org-1', 'member', passkey);
  });

  it('travel as this frontend’s own URL, naming the agreement when there is one', () => {
    const loc = { origin: 'http://localhost:5173', pathname: '/agreements/a1' };
    expect(inviteLink('tok', 'a1', loc)).toBe(
      'http://localhost:5173/agreements/a1?invite=tok&agreement=a1',
    );
    expect(inviteLink('tok', null, loc)).toBe('http://localhost:5173/agreements/a1?invite=tok');
  });

  it('are taken off the address bar before anything renders, and survive until dropped', () => {
    window.history.replaceState(null, '', '/?invite=tok&agreement=a1&x=1');
    captureInvite();
    expect(window.location.search).toBe('?x=1');
    expect(pendingInvite()).toEqual({ token: 'tok', agreement: 'a1' });
    dropInvite();
    expect(pendingInvite()).toBeNull();
  });

  it('name the org they joined, whichever field the node used', () => {
    expect(joinedOrg({ org: 'o1' })).toBe('o1');
    expect(joinedOrg({ orgId: 'o2' })).toBe('o2');
    expect(joinedOrg({})).toBeNull();
  });
});
