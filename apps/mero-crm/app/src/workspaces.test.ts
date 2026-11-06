import { CalimeroError } from '@calimero-network/mero-js';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  captureInvite,
  dropInvite,
  inviteLink,
  isSpentInvite,
  pendingInvite,
  pendingInviteOrg,
  pendingInviteRoute,
} from './workspaces';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('invitation links', () => {
  it('name the org beside the token, on the page they were made from', () => {
    const link = new URL(inviteLink('inv_1', 'org-1', { origin: 'https://x.example', pathname: '/1.2.0/crm/members' }));
    expect(link.pathname).toBe('/1.2.0/crm/members');
    expect(link.searchParams.get('invite')).toBe('inv_1');
    expect(link.searchParams.get('org')).toBe('org-1');
  });

  it('keep the token, the org and the route under the node basename, and leave the address bar clean', () => {
    // Where a node serves the app, the router's basename is `/{version}/`.
    window.history.replaceState(null, '', '/1.2.0/crm/members?invite=inv_1&org=org-1');
    captureInvite(localStorage, window.location, '/1.2.0/');
    expect(pendingInvite()).toBe('inv_1');
    expect(pendingInviteOrg()).toBe('org-1');
    expect(pendingInviteRoute()).toBe('/crm/members');
    expect(window.location.pathname).toBe('/1.2.0/crm/members');
    expect(window.location.search).toBe('');
  });

  it('open the CRM when the link was made outside it', () => {
    window.history.replaceState(null, '', '/docs?invite=inv_1');
    captureInvite(localStorage, window.location);
    expect(pendingInviteOrg()).toBeNull();
    expect(pendingInviteRoute()).toBe('/crm');
    dropInvite();
    expect(pendingInvite()).toBeNull();
    expect(pendingInviteRoute()).toBe('/crm');
  });

  it('count a 4xx redemption as a spent invite, and a 5xx or a 401 as retryable', () => {
    expect(isSpentInvite(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'))).toBe(true);
    expect(isSpentInvite(new CalimeroError(410, 'GONE', 'expired'))).toBe(true);
    expect(isSpentInvite(new CalimeroError(401, 'UNAUTHENTICATED', 'sign in'))).toBe(false);
    expect(isSpentInvite(new CalimeroError(503, 'UNAVAILABLE', 'later'))).toBe(false);
    expect(isSpentInvite(new Error('offline'))).toBe(false);
  });
});
