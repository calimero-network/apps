import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TrustPage from './TrustPage';

const session = vi.hoisted(() => ({ client: null as unknown, appId: 'app-1' as string | null }));
vi.mock('../../sessionContext', () => ({ useSignedIn: () => ({ client: session.client }) }));
vi.mock('./appContext', () => ({ useAppCtx: () => ({ ws: { activeRepo: session.appId } }) }));
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceTrust: ({ release, appId }: { release: { package: string; version: string }; appId: string }) => (
    <div data-testid="workspace-trust" data-package={release.package} data-version={release.version} data-app={appId} />
  ),
}));

/** A client whose report says `app-1` runs `running` (`null`: a raw bundle, no release). */
function reporting(running: { package: string; version: string } | null) {
  session.client = {
    apps: { get: vi.fn(async () => ({ org: 'org-1' })) },
    appsReportAll: vi.fn(async () => ({ apps: [{ app: 'app-1', package: running }] })),
  };
}

afterEach(cleanup);

describe('TrustPage', () => {
  it('shows the trust panel for the release the open repo runs', async () => {
    reporting({ package: 'com.calimero.mero-issue-tracker', version: '1.3.0' });
    render(<TrustPage />);
    const panel = await screen.findByTestId('workspace-trust');
    expect(panel.dataset).toMatchObject({ package: 'com.calimero.mero-issue-tracker', version: '1.3.0', app: 'app-1' });
  });

  it('says the repo runs no published release when it runs a raw bundle', async () => {
    reporting(null);
    render(<TrustPage />);
    expect(await screen.findByText(/runs no published release/)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
  });

  it('says the release could not be read, apart from having none, and reads again on Try again', async () => {
    session.client = {
      apps: { get: vi.fn(async () => ({ org: 'org-1' })) },
      appsReportAll: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ apps: [{ app: 'app-1', package: { package: 'p', version: '1.3.0' } }] }),
    };
    render(<TrustPage />);
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByText(/runs no published release/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('workspace-trust')).dataset.version).toBe('1.3.0');
  });

  it('says it could not be read when the report does not list the repo', async () => {
    session.client = {
      apps: { get: vi.fn(async () => ({ org: 'org-1' })) },
      appsReportAll: vi.fn(async () => ({ apps: [] })),
    };
    render(<TrustPage />);
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});
