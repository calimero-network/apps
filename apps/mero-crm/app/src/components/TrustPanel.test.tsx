import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

type Running = { package: string; version: string } | null;

const CRM = { package: 'com.calimero.mero-crm', version: '1.2.0' };
const NEWER = { ...CRM, version: '1.3.0' };

/** A client whose instance `app` runs what `running(app)` resolves to, as its scope's report says (the instance's org is its own id here). */
function reporting(running: (app: string) => Promise<Running>) {
  return {
    apps: { get: vi.fn(async ({ app }: { app: string }) => ({ org: app })) },
    appsReportAll: vi.fn(async (org: string) => ({ apps: [{ app: org, package: await running(org) }] })),
  } as unknown as CalimeroClient;
}

/** A read that answers when the test says. */
function held() {
  let resolve: (v: Running) => void = () => {};
  const promise = new Promise<Running>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('TrustPanel', () => {
  it('shows the trust view of the release the instance runs, not the one the page was built for', async () => {
    render(<TrustPanel client={reporting(async () => CRM)} appId="app-1" />);
    const trust = await screen.findByTestId('workspace-trust');
    expect(trust.getAttribute('data-release')).toBe('com.calimero.mero-crm@1.2.0');
    expect(trust.getAttribute('data-app')).toBe('app-1');
  });

  it('says so when the instance runs no published release', async () => {
    render(<TrustPanel client={reporting(async () => null)} appId="app-1" />);
    expect(await screen.findByText(/does not run a published release/)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
  });

  it('says a failed read apart from "no release", and reads again on Try again', async () => {
    let fail = true;
    render(<TrustPanel client={reporting(async () => { if (fail) throw new Error('offline'); return CRM; })} appId="app-1" />);
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByText(/does not run a published release/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('workspace-trust')).getAttribute('data-release')).toBe('com.calimero.mero-crm@1.2.0');
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it("never shows the previous instance's release while the next one is read", async () => {
    const next = held();
    const client = reporting((app) => (app === 'app-1' ? Promise.resolve(CRM) : next.promise));
    const { rerender } = render(<TrustPanel client={client} appId="app-1" />);
    await screen.findByTestId('workspace-trust');
    rerender(<TrustPanel client={client} appId="app-2" />);
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
    next.resolve(NEWER);
    const trust = await screen.findByTestId('workspace-trust');
    expect(trust.getAttribute('data-app')).toBe('app-2');
    expect(trust.getAttribute('data-release')).toBe('com.calimero.mero-crm@1.3.0');
  });

  it('ignores a slow read of an instance that is no longer the open one', async () => {
    const first = held();
    const client = reporting((app) => (app === 'app-1' ? first.promise : Promise.resolve(NEWER)));
    const { rerender } = render(<TrustPanel client={client} appId="app-1" />);
    rerender(<TrustPanel client={client} appId="app-2" />);
    await screen.findByTestId('workspace-trust');
    first.resolve(CRM);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('workspace-trust').getAttribute('data-release')).toBe('com.calimero.mero-crm@1.3.0');
  });
});
