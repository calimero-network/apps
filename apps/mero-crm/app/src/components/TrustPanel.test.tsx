import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TrustPanel from './TrustPanel';

// The panel's job is which instance and source it hands the shared view.
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceTrust: ({ appId, source, subject }: { appId: string; source: { package: string }; subject?: string }) => (
    <div data-testid="workspace-trust" data-app={appId} data-package={source.package} data-subject={subject ?? ''} />
  ),
}));

afterEach(cleanup);

describe('TrustPanel', () => {
  it('hands the shared view the open pipeline, the app source and what it covers', () => {
    render(<TrustPanel appId="app-1" source={{ package: 'com.calimero.mero-crm' }} pipeline="New business" />);
    const trust = screen.getByTestId('workspace-trust');
    expect(trust.dataset).toMatchObject({ app: 'app-1', package: 'com.calimero.mero-crm', subject: 'the pipeline New business' });
  });

  it('names no pipeline when it has none', () => {
    render(<TrustPanel appId="app-1" source={{ package: 'com.calimero.mero-crm' }} />);
    expect(screen.getByTestId('workspace-trust').dataset.subject).toBe('');
  });
});
