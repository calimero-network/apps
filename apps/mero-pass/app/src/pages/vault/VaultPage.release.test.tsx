/**
 * A vault is an app instance, served the frontend of the release it runs
 * (`useInstanceRelease`): on a page a node serves, opening one that runs
 * another release moves the page there and shows nothing of the vault; on
 * its own release, or in development, it stays.
 */
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `useInstanceRelease` as on a page a node serves from `release.href` (a
// release's `/{version}/`), going nowhere but `release.navigate`. With no
// `href` it reads this test's own location: development, where it never moves.
const release = vi.hoisted(() => ({
  href: null as string | null,
  navigate: vi.fn(),
}));
vi.mock('@calimero-apps/passkey', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@calimero-apps/passkey')>();
  return {
    ...actual,
    useInstanceRelease: (
      ...[client, app]: Parameters<typeof actual.useInstanceRelease>
    ) =>
      actual.useInstanceRelease(
        client,
        app,
        release.href ? { href: release.href, navigate: release.navigate } : {},
      ),
  };
});

// Signed in on `signedIn.client`.
const signedIn = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../calimero', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCalimero: () => ({
    status: 'signed-in',
    isAuthenticated: true,
    isLoading: false,
    client: signedIn.client,
    target: null,
    accountId: 'acct-me',
    source: 'bundle',
    message: null,
    error: null,
    busy: false,
    where: 'merod local',
    after: () => {},
    passkey: () => ({}),
  }),
}));
// The page's frame and the vault behind its lock are tested on their own.
vi.mock('../../components/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="vault-page">{children}</div>
  ),
  InRail: () => null,
}));
vi.mock('../../components/LockGate', () => ({ default: () => null }));

import VaultPage from './VaultPage';
import { withRoutes } from '@calimero-apps/connect/testing';

const HOST = `https://${'a'.repeat(52)}.apps.calimero.network`;

/** The page of vault `vault-1`, which runs `version`. */
function openVault(version: string) {
  const client = withRoutes({
    view: vi.fn(async () => ({ index: 1, result: 'Ops' })),
    getApp: vi.fn(async () => ({ appId: 'vault-1', org: 'org-1' })),
    appsReportAll: vi.fn(async () => ({
      apps: [
        { app: 'vault-1', package: { package: 'com.calimero.pass', version } },
      ],
    })),
  });
  signedIn.client = client;
  render(
    <MemoryRouter initialEntries={['/vault/vault-1']}>
      <Routes>
        <Route path="/vault/:vaultId" element={<VaultPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return client;
}

beforeEach(() => {
  sessionStorage.clear();
  release.href = null;
  release.navigate.mockClear();
});
afterEach(cleanup);

describe('the release the open vault runs (useInstanceRelease)', () => {
  it('moves a served page to the frontend of the release the vault runs, and shows nothing of it meanwhile', async () => {
    release.href = `${HOST}/1.2.0/vault/vault-1`;
    openVault('1.0.0');
    await waitFor(() =>
      expect(release.navigate).toHaveBeenCalledWith(
        `${HOST}/app/vault-1/vault/vault-1`,
      ),
    );
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('vault-page')).toBeNull());
  });

  it('stays on a served page of the release the vault runs', async () => {
    release.href = `${HOST}/1.2.0/vault/vault-1`;
    const client = openVault('1.2.0');
    await waitFor(() =>
      expect(client.appsReportAll).toHaveBeenCalledWith('org-1'),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('vault-page')).toBeTruthy();
  });

  it('does nothing in development', async () => {
    const client = openVault('1.0.0');
    await waitFor(() => expect(client.view).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('vault-page')).toBeTruthy();
  });
});
