import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import {
  SessionProvider,
  useSession,
  type SessionApi,
  type SessionDeps,
} from '../session';

const PACKAGE = 'com.calimero.mero-drive-docs';

let passkey: { session: unknown; store: undefined };
vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePasskeySession: () => passkey,
}));

const signedIn = (client: CalimeroClient, accountId: string) => ({
  session: { status: 'signed-in', client, accountId },
  store: undefined,
});
const signedOut = { session: { status: 'signed-out' }, store: undefined };

function deferred() {
  let resolve: (latest: string) => void = () => {};
  const promise = new Promise<{ latest: string }>((done) => {
    resolve = (latest) => done({ latest });
  });
  return { promise, resolve };
}

function mount(env: Record<string, unknown>) {
  let held: SessionApi | null = null;
  function Probe() {
    held = useSession();
    return null;
  }
  const deps = {
    env,
    makeClient: async () => ({}),
    passkey: () => ({}),
  } as unknown as SessionDeps;
  const tree = () => (
    <SessionProvider deps={deps}>
      <Probe />
    </SessionProvider>
  );
  const view = render(tree());
  return { api: () => held!, rerender: () => view.rerender(tree()) };
}

afterEach(cleanup);

describe('the release a session creates from', () => {
  it('is read again for the next account on the same client, never reusing the last one', async () => {
    const reads = [deferred(), deferred()];
    let reading = 0;
    const get = vi.fn(() => reads[reading++]!.promise);
    const client = { packages: { get } } as unknown as CalimeroClient;
    passkey = signedIn(client, 'account-a');
    const { api, rerender } = mount({ DEV: true });
    reads[0]!.resolve('1.0.0');
    await waitFor(() => expect(api().resolvingSource).toBe(false));
    expect(api().source).toEqual({ package: PACKAGE, version: '1.0.0' });

    passkey = signedOut as never;
    rerender();
    passkey = signedIn(client, 'account-b');
    rerender();
    expect(api().resolvingSource).toBe(true);
    expect(api().source).toEqual({ package: PACKAGE });

    reads[1]!.resolve('2.0.0');
    await waitFor(() => expect(api().resolvingSource).toBe(false));
    expect(api().source).toEqual({ package: PACKAGE, version: '2.0.0' });
  });

  it('is never pending for a development bundle or a named version, and reads nothing', () => {
    const client = { packages: { get: vi.fn() } } as unknown as CalimeroClient;
    passkey = signedIn(client, 'account-a');
    const bundle = mount({ DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' });
    expect(bundle.api().resolvingSource).toBe(false);
    expect(bundle.api().source).toBe('bundle-hash');
    cleanup();
    const named = mount({ DEV: true, VITE_CALIMERO_VERSION: '3.1.0' });
    expect(named.api().resolvingSource).toBe(false);
    expect(named.api().source).toEqual({ package: PACKAGE, version: '3.1.0' });
    expect(client.packages.get).not.toHaveBeenCalled();
  });
});
