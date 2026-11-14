import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useNodeShieldApp } from '@calimero-apps/passkey';
import { DriveWorkspaceProvider } from '../useDriveWorkspace';

const SOURCE = { package: 'network.calimero.docs', version: '1.2.0' };

vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNodeShieldApp: vi.fn(),
}));
vi.mock('@/calimero/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({
    session: {
      status: 'signed-in',
      target: { kind: 'local', nodes: ['http://n'] },
    },
    source: SOURCE,
  }),
}));
vi.mock('@/calimero/react', async (importOriginal) => {
  const admin = {
    listNamespaces: async () => [{ namespaceId: 'ws1', name: 'W' }],
    org: async () => ({
      orgId: 'ws1',
      name: 'W',
      members: { me: 'owner' },
      teams: {},
      defaultCapabilities: 0,
      capabilities: {},
      metadata: { registryApp: 'reg-1' },
      memberMetadata: {},
      mode: null,
    }),
    onChange: () => () => {},
  };
  return {
    ...(await importOriginal<object>()),
    useLive: () => ({
      admin,
      client: null,
      accountId: 'me',
      events: { online: true, onOnline: () => () => {} },
    }),
  };
});

afterEach(cleanup);

describe('DriveWorkspaceProvider node shield', () => {
  it('tells the shield the workspace registry instance and the app source', async () => {
    render(
      <MemoryRouter initialEntries={['/app/ws1']}>
        <DriveWorkspaceProvider>{null}</DriveWorkspaceProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(vi.mocked(useNodeShieldApp)).toHaveBeenCalledWith('reg-1', SOURCE),
    );
  });
});
