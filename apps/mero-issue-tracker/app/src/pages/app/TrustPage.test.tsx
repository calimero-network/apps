import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TrustPage from './TrustPage';

const open = vi.hoisted(() => ({ appId: 'app-1' as string | null, source: { package: 'com.calimero.mero-issue-tracker' } as unknown }));
vi.mock('../../sessionContext', () => ({ useSignedIn: () => ({ source: open.source }) }));
vi.mock('./appContext', () => ({ useAppCtx: () => ({ ws: { activeRepo: open.appId, repos: [{ contextId: 'app-1', name: 'web' }] } }) }));
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceTrust: ({ appId, source, subject }: { appId: string; source: { package: string }; subject?: string }) => (
    <div data-testid="workspace-trust" data-app={appId} data-package={source.package} data-subject={subject ?? ''} />
  ),
}));

afterEach(cleanup);

describe('TrustPage', () => {
  it('hands the shared view the open repo, its name and the app source', () => {
    render(<TrustPage />);
    expect(screen.getByTestId('workspace-trust').dataset).toMatchObject({ app: 'app-1', package: 'com.calimero.mero-issue-tracker', subject: 'the repository web' });
  });

  it('shows no trust view without an open repo', () => {
    open.appId = null;
    render(<TrustPage />);
    expect(screen.queryByTestId('workspace-trust')).toBeNull();
    open.appId = 'app-1';
  });
});
