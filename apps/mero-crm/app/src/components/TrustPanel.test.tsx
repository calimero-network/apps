import { cleanup, render, screen } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TrustPanel from './TrustPanel';

// The panel's job is which release and instance it hands the shared view.
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceTrust: ({ release, appId }: { release: { package: string; version: string }; appId: string }) => (
    <div data-testid="workspace-trust" data-release={`${release.package}@${release.version}`} data-app={appId} />
  ),
}));

afterEach(cleanup);

/** A client whose instance `app-1` runs `running`, as its scope's report says. */
function clientRunning(running: { package: string; version: string } | null) {
  return {
    apps: { get: vi.fn(async () => ({ org: null })) },
    appsReportAll: vi.fn(async () => ({ apps: [{ app: 'app-1', package: running }] })),
  } as unknown as CalimeroClient;
}

describe('TrustPanel', () => {
  it('shows the trust view of the release the instance runs, not the one the page was built for', async () => {
    render(<TrustPanel client={clientRunning({ package: 'com.calimero.mero-crm', version: '1.2.0' })} appId="app-1" />);
    const trust = await screen.findByTestId('workspace-trust');
    expect(trust.getAttribute('data-release')).toBe('com.calimero.mero-crm@1.2.0');
    expect(trust.getAttribute('data-app')).toBe('app-1');
  });

  it('says so when the instance runs no published release', async () => {
    render(<TrustPanel client={clientRunning(null)} appId="app-1" />);
    expect(await screen.findByText(/does not run a published release/)).toBeTruthy();
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
  });
});
