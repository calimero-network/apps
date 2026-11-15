import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import type { AppSource } from '@calimero-apps/connect';
import { useResolvedSource } from '../releaseSource';

const PACKAGE = 'network.calimero.docs';

function clientWith(get: () => Promise<{ latest: string }>) {
  return { packages: { get: vi.fn(get) } } as unknown as CalimeroClient;
}

function resolve(
  base: AppSource,
  client: CalimeroClient | null,
  href = 'http://localhost/',
) {
  return renderHook(() => useResolvedSource(base, client, href));
}

describe('useResolvedSource', () => {
  it('pins an unversioned package to the newest release the client reads', async () => {
    const client = clientWith(async () => ({ latest: '2.0.0' }));
    const { result } = resolve({ package: PACKAGE }, client);
    expect(result.current.resolving).toBe(true);
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.source).toEqual({
      package: PACKAGE,
      version: '2.0.0',
    });
    expect(client.packages.get).toHaveBeenCalledTimes(1);
  });

  it('keeps the same source object across renders once resolved', async () => {
    const client = clientWith(async () => ({ latest: '2.0.0' }));
    const { result, rerender } = resolve({ package: PACKAGE }, client);
    await waitFor(() => expect(result.current.resolving).toBe(false));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('falls back to the release the page is served from when the read fails', async () => {
    const client = clientWith(async () => {
      throw new Error('offline');
    });
    const { result } = resolve(
      { package: PACKAGE },
      client,
      `https://${'a'.repeat(52)}.apps.calimero.network/1.5.0/app`,
    );
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.source).toEqual({
      package: PACKAGE,
      version: '1.5.0',
    });
  });

  it('stays unversioned when the read fails and the page is not served', async () => {
    const client = clientWith(async () => {
      throw new Error('offline');
    });
    const { result } = resolve({ package: PACKAGE }, client);
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.source).toEqual({ package: PACKAGE });
  });

  it('leaves a named version and a development bundle alone, without reading', () => {
    const client = clientWith(async () => ({ latest: '9.9.9' }));
    const { result: named } = resolve(
      { package: PACKAGE, version: '1.2.0' },
      client,
    );
    expect(named.current).toEqual({
      source: { package: PACKAGE, version: '1.2.0' },
      resolving: false,
    });
    const { result: bundle } = resolve('bundle-hash', client);
    expect(bundle.current).toEqual({
      source: 'bundle-hash',
      resolving: false,
    });
    expect(client.packages.get).not.toHaveBeenCalled();
  });

  it('waits for a client while signed out', () => {
    const { result } = resolve({ package: PACKAGE }, null);
    expect(result.current).toEqual({
      source: { package: PACKAGE },
      resolving: false,
    });
  });
});
