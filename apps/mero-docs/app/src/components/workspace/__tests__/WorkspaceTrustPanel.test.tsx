import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { instancePackage } from '@calimero-apps/connect';
import { WorkspaceTrustPanel } from '../WorkspaceTrustPanel';

const client = {};

vi.mock('@calimero-apps/connect', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  instancePackage: vi.fn(),
}));
vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WorkspaceTrust: ({
    release,
    appId,
  }: {
    release: { package: string; version: string };
    appId: string;
  }) => (
    <div data-testid="trust">
      {release.package}@{release.version} for {appId}
    </div>
  ),
}));
vi.mock('@/calimero/session', () => ({
  useSession: () => ({ session: { status: 'signed-in', client } }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryContextId: 'reg-1' }),
}));

beforeEach(() => vi.mocked(instancePackage).mockReset());
afterEach(cleanup);

describe('WorkspaceTrustPanel', () => {
  it('shows the trust view of the release the workspace instance runs', async () => {
    vi.mocked(instancePackage).mockResolvedValue({
      package: 'network.calimero.docs',
      version: '1.1.0',
    } as never);
    render(<WorkspaceTrustPanel />);
    expect((await screen.findByTestId('trust')).textContent).toBe(
      'network.calimero.docs@1.1.0 for reg-1',
    );
    expect(instancePackage).toHaveBeenCalledWith(client, 'reg-1');
  });

  it('says so when the running release cannot be read', async () => {
    vi.mocked(instancePackage).mockResolvedValue(null);
    render(<WorkspaceTrustPanel />);
    expect(await screen.findByText(/could not read the release/i)).toBeTruthy();
    expect(screen.queryByTestId('trust')).toBeNull();
  });
});
