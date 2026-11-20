import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UpdatesPanel from './UpdatesPanel';

// The panel's job is which instance it hands the shared view, and what it covers.
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceUpdates: ({ appId, subject }: { appId: string; subject?: string }) => (
    <div data-testid="workspace-updates" data-app={appId} data-subject={subject ?? ''} />
  ),
}));

afterEach(cleanup);

describe('UpdatesPanel', () => {
  it('hands the shared view the open pipeline and what it covers', () => {
    render(<UpdatesPanel appId="app-1" pipeline="New business" />);
    expect(screen.getByTestId('workspace-updates').dataset).toMatchObject({ app: 'app-1', subject: 'the pipeline New business' });
  });

  it('names no pipeline when it has none', () => {
    render(<UpdatesPanel appId="app-1" />);
    expect(screen.getByTestId('workspace-updates').dataset.subject).toBe('');
  });
});
