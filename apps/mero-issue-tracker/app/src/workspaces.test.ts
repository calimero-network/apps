import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import type { ClientRoutes } from '@calimero-apps/connect';
import { orgCluster } from '@calimero-apps/connect/testing';

import { APP_NAME } from './config';
import { addRepo, createWorkspace, inviteLink, inviteRoute, invites, migrateLegacyInvite, newWorkspaceRelease } from './workspaces';

/** A host a Calimero node serves an installed app on: `{label}.{domain}`, routes under `/{version}/`. */
const SERVED = `https://${'a'.repeat(52)}.apps.calimero.network`;

beforeEach(() => {
  localStorage.clear();
  invites.drop();
  window.history.replaceState(null, '', '/');
});

describe('invitation links', () => {
  it('name the org and the page they were made on, under the served version root', () => {
    const link = new URL(inviteLink('inv_1', 'org-1', { href: `${SERVED}/1.2.0/issue-tracker/board` }));
    expect(link.origin).toBe(SERVED);
    expect(link.pathname).toBe('/1.2.0/');
    expect(link.searchParams.get('invite')).toBe('inv_1');
    expect(link.searchParams.get('org')).toBe('org-1');
    expect(link.searchParams.get('to')).toBe('/issue-tracker/board');
  });

  it('keep the token, the org and the route, and leave the address bar clean', () => {
    window.history.replaceState(null, '', '/?invite=inv_1&org=org-1&to=%2Fissue-tracker%2Fboard');
    invites.capture(window.location);
    expect(invites.token()).toBe('inv_1');
    expect(invites.pending()?.org).toBe('org-1');
    expect(inviteRoute(invites.pending())).toBe('/issue-tracker/board');
    expect(window.location.search).toBe('');
  });

  it('read an older version-pinned link the same way', () => {
    window.history.replaceState(null, '', '/1.2.0/issue-tracker/board?invite=inv_1&org=org-1');
    invites.capture(window.location, { basename: '/1.2.0/' });
    expect(inviteRoute(invites.pending())).toBe('/issue-tracker/board');
  });

  it('open the tracker when the link was made outside it', () => {
    window.history.replaceState(null, '', '/docs?invite=inv_1');
    invites.capture(window.location);
    expect(invites.pending()?.org).toBeNull();
    expect(inviteRoute(invites.pending())).toBe('/issue-tracker');
    invites.drop();
    expect(invites.token()).toBeNull();
    expect(inviteRoute(invites.pending())).toBe('/issue-tracker');
  });

  it('move an invite an earlier build stored under its own keys into the shared store', () => {
    localStorage.setItem(`${APP_NAME}:pending-invite`, 'inv_old');
    localStorage.setItem(`${APP_NAME}:pending-invite-org`, 'org-1');
    localStorage.setItem(`${APP_NAME}:pending-invite-route`, '/issue-tracker/board');
    migrateLegacyInvite();
    expect(invites.token()).toBe('inv_old');
    expect(invites.pending()?.org).toBe('org-1');
    expect(inviteRoute(invites.pending())).toBe('/issue-tracker/board');
    expect(localStorage.getItem(`${APP_NAME}:pending-invite`)).toBeNull();
    expect(localStorage.getItem(`${APP_NAME}:pending-invite-org`)).toBeNull();
  });
});

describe('the release a new workspace runs', () => {
  const PKG = 'com.calimero.mero-issue-tracker';
  type Node = { packages: { get: Mock } };
  const node = (get: Mock): Node & ClientRoutes<{ packages: 'get' }> => ({ packages: { get } }) as never;
  const reading = (latest: string) => node(vi.fn(async () => ({ package: PKG, latest, versions: [] })));
  const failing = () => node(vi.fn(async () => Promise.reject(new Error('boom'))));

  it('is the version the build names, without reading one', async () => {
    const client = reading('1.4.0');
    expect(await newWorkspaceRelease(client, { package: PKG, version: '2.0.0' })).toEqual({ package: PKG, version: '2.0.0' });
    expect(client.packages.get).not.toHaveBeenCalled();
  });

  it('is the newest the node has, read once for the session', async () => {
    const client = reading('1.4.0');
    expect(await newWorkspaceRelease(client, { package: PKG })).toEqual({ package: PKG, version: '1.4.0' });
    client.packages.get.mockResolvedValue({ package: PKG, latest: '1.5.0', versions: [] });
    expect(await newWorkspaceRelease(client, { package: PKG })).toEqual({ package: PKG, version: '1.4.0' });
    expect(client.packages.get).toHaveBeenCalledTimes(1);
  });

  it('is the release this page is served from when the node cannot say, and asked again next time', async () => {
    const client = failing();
    const href = `${SERVED}/1.2.0/issue-tracker`;
    expect(await newWorkspaceRelease(client, { package: PKG }, href)).toEqual({ package: PKG, version: '1.2.0' });
    await newWorkspaceRelease(client, { package: PKG }, href);
    expect(client.packages.get).toHaveBeenCalledTimes(2);
  });

  it('is none when the node cannot say and the page is not served by a node', async () => {
    expect(await newWorkspaceRelease(failing(), { package: PKG }, 'http://localhost:5173/')).toBeNull();
  });

  it('is none for a development bundle', async () => {
    const client = reading('1.4.0');
    expect(await newWorkspaceRelease(client, 'bundle-hash')).toBeNull();
    expect(client.packages.get).not.toHaveBeenCalled();
  });

  it('is the version the first repository is created from, and every later one', async () => {
    const passkey = () => ({}) as PasskeyProvider;
    const cluster = orgCluster();
    const get = vi.fn(async () => ({ latest: '1.4.0' }));
    const client = Object.assign(cluster.client, { packages: { get } });
    const { namespaceId: org } = await createWorkspace(client, 'Acme', passkey, { package: PKG });
    await addRepo(client, { package: PKG }, org, 'Main', '', passkey);
    get.mockImplementation(async () => ({ latest: '1.5.0' }));
    await addRepo(client, { package: PKG }, org, 'Second', '', passkey);
    expect(cluster.callsOf('createApp').map((c) => c[1])).toEqual([
      { package: PKG, version: '1.4.0' },
      { package: PKG, version: '1.4.0' },
    ]);
  });
});
