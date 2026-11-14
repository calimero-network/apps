import { cleanup, render, screen } from '@testing-library/react';
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

  it('says there is no signed release to review when the repo has none', async () => {
    reporting(null);
    render(<TrustPage />);
    expect(await screen.findByText(/No signed release to review/)).toBeTruthy();
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
  });
});
