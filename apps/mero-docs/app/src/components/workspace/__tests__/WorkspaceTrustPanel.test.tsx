import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkspaceTrustPanel } from '../WorkspaceTrustPanel';

let registry: string | null = 'reg-1';
const source = { package: 'network.calimero.docs', version: '1.1.0' };

vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WorkspaceTrust: (props: {
    appId: string;
    source: unknown;
    subject?: string;
  }) => <div data-testid="trust">{JSON.stringify(props)}</div>,
}));
vi.mock('@/calimero/session', () => ({
  useSession: () => ({ source }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryContextId: registry }),
}));

beforeEach(() => {
  registry = 'reg-1';
});
afterEach(cleanup);

describe('WorkspaceTrustPanel', () => {
  it('shows the trust view of the registry instance, for the session source, naming its scope', () => {
    render(<WorkspaceTrustPanel />);
    expect(JSON.parse(screen.getByTestId('trust').textContent!)).toEqual({
      appId: 'reg-1',
      source,
      subject: "this workspace's shared settings",
    });
  });

  it('says to open a folder to check the code its documents run on', () => {
    render(<WorkspaceTrustPanel />);
    expect(
      screen.getByText(
        /open a folder to check the code its documents run on, from the node shield/i,
      ),
    ).toBeTruthy();
  });

  it('shows nothing before the workspace has a registry instance', () => {
    registry = null;
    render(<WorkspaceTrustPanel />);
    expect(screen.queryByTestId('trust')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Trust' })).toBeNull();
  });
});
