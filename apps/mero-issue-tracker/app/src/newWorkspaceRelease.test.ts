import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ClientRoutes } from '@calimero-apps/connect';

import { newWorkspaceRelease } from './newWorkspaceRelease';

/** A host a Calimero node serves an installed app on: `{label}.{domain}`, routes under `/{version}/`. */
const SERVED = `https://${'a'.repeat(52)}.apps.calimero.network`;

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
});
