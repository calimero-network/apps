import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkspaceUpdatesPanel } from '../WorkspaceUpdatesPanel';

let registry: string | null = 'reg-1';

vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WorkspaceUpdates: (props: { appId: string; subject?: string }) => (
    <div data-testid="updates">{JSON.stringify(props)}</div>
  ),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryContextId: registry }),
}));

beforeEach(() => {
  registry = 'reg-1';
});
afterEach(cleanup);

describe('WorkspaceUpdatesPanel', () => {
  it('shows the updates of the registry instance, naming its scope', () => {
    render(<WorkspaceUpdatesPanel />);
    expect(JSON.parse(screen.getByTestId('updates').textContent!)).toEqual({
      appId: 'reg-1',
      subject: "this workspace's shared settings",
    });
    expect(screen.getByRole('region', { name: 'Updates' })).toBeTruthy();
  });

  it('shows nothing before the workspace has a registry instance', () => {
    registry = null;
    render(<WorkspaceUpdatesPanel />);
    expect(screen.queryByTestId('updates')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Updates' })).toBeNull();
  });
});
