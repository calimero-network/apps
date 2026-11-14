import { beforeEach, describe, expect, it } from 'vitest';

import { APP_NAME } from './config';
import { inviteLink, inviteRoute, invites, migrateLegacyInvite, pinnedSource, reviewRelease } from './workspaces';

/** A host a Calimero node serves an installed app on: `{label}.{domain}`, routes under `/{version}/`. */
const SERVED = `https://${'a'.repeat(52)}.apps.calimero.network`;

beforeEach(() => {
  localStorage.clear();
  invites.drop();
  window.history.replaceState(null, '', '/');
});

describe('invitation links', () => {
  it('name the org and the page they were made on, under the served version root', () => {
    const link = new URL(inviteLink('inv_1', 'org-1', { href: `${SERVED}/1.2.0/crm/members` }));
    expect(link.origin).toBe(SERVED);
    expect(link.pathname).toBe('/1.2.0/');
    expect(link.searchParams.get('invite')).toBe('inv_1');
    expect(link.searchParams.get('org')).toBe('org-1');
    expect(link.searchParams.get('to')).toBe('/crm/members');
  });

  it('keep the token, the org and the route, and leave the address bar clean', () => {
    window.history.replaceState(null, '', '/?invite=inv_1&org=org-1&to=%2Fcrm%2Fmembers');
    invites.capture(window.location);
    expect(invites.token()).toBe('inv_1');
    expect(invites.pending()?.org).toBe('org-1');
    expect(inviteRoute(invites.pending())).toBe('/crm/members');
    expect(window.location.search).toBe('');
  });

  it('read an older version-pinned link the same way', () => {
    window.history.replaceState(null, '', '/1.2.0/crm/members?invite=inv_1&org=org-1');
    invites.capture(window.location, { basename: '/1.2.0/' });
    expect(inviteRoute(invites.pending())).toBe('/crm/members');
  });

  it('open the CRM when the link was made outside it', () => {
    window.history.replaceState(null, '', '/docs?invite=inv_1');
    invites.capture(window.location);
    expect(invites.pending()?.org).toBeNull();
    expect(inviteRoute(invites.pending())).toBe('/crm');
    invites.drop();
    expect(invites.token()).toBeNull();
    expect(inviteRoute(invites.pending())).toBe('/crm');
  });

  it('move an invite an earlier build stored under its own keys into the shared store', () => {
    localStorage.setItem(`${APP_NAME}:pending-invite`, 'inv_old');
    localStorage.setItem(`${APP_NAME}:pending-invite-org`, 'org-1');
    localStorage.setItem(`${APP_NAME}:pending-invite-route`, '/crm/deals');
    migrateLegacyInvite();
    expect(invites.token()).toBe('inv_old');
    expect(invites.pending()?.org).toBe('org-1');
    expect(inviteRoute(invites.pending())).toBe('/crm/deals');
    expect(localStorage.getItem(`${APP_NAME}:pending-invite`)).toBeNull();
    expect(localStorage.getItem(`${APP_NAME}:pending-invite-org`)).toBeNull();
  });
});

describe('the release a new workspace is created from', () => {
  const PKG = 'com.calimero.mero-crm';

  it('is the version the source names', () => {
    const source = pinnedSource({ package: PKG, version: '1.4.0' }, `${SERVED}/1.2.0/crm`);
    expect(reviewRelease(source)).toEqual({ package: PKG, version: '1.4.0' });
  });

  it('is the release this page is served from when the source names none, and the create is pinned to it', () => {
    const source = pinnedSource({ package: PKG }, `${SERVED}/1.2.0/crm`);
    expect(source).toEqual({ package: PKG, version: '1.2.0' });
    expect(reviewRelease(source)).toEqual({ package: PKG, version: '1.2.0' });
  });

  it('is none where nothing says a version, or for a raw bundle', () => {
    expect(reviewRelease(pinnedSource({ package: PKG }, 'http://localhost:5173/crm'))).toBeNull();
    expect(reviewRelease(pinnedSource('bundle-hash', `${SERVED}/1.2.0/crm`))).toBeNull();
  });
});
