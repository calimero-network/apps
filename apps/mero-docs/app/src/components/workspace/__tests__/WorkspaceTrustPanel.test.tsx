import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceTrustPanel } from '../WorkspaceTrustPanel';

let registry = 'reg-1';
const get = vi.fn();
const appsReportAll = vi.fn();
const client = { apps: { get }, appsReportAll };

vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  WorkspaceTrust: ({
    release,
    appId,
  }: {
    release: { package: string; version: string };
    appId: string;
  }) => (
    <div data-testid="trust">
      {release.package}@{release.version} for {appId}
    </div>
  ),
}));
vi.mock('@/calimero/session', () => ({
  useSession: () => ({ session: { status: 'signed-in', client } }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryContextId: registry }),
}));

const report = (entry: object, app = 'reg-1') => ({
  apps: [{ app, ...entry }],
});

beforeEach(() => {
  registry = 'reg-1';
  get.mockReset().mockResolvedValue({ org: 'org-1' });
  appsReportAll.mockReset();
});
afterEach(cleanup);

describe('WorkspaceTrustPanel', () => {
  it('shows the trust view of the release the workspace instance runs', async () => {
    appsReportAll.mockResolvedValue(
      report({
        package: { package: 'network.calimero.docs', version: '1.1.0' },
      }),
    );
    render(<WorkspaceTrustPanel />);
    expect((await screen.findByTestId('trust')).textContent).toBe(
      'network.calimero.docs@1.1.0 for reg-1',
    );
    expect(get).toHaveBeenCalledWith({ app: 'reg-1' });
    expect(appsReportAll).toHaveBeenCalledWith('org-1');
  });

  it('says the instance runs no published release, without offering a retry', async () => {
    appsReportAll.mockResolvedValue(report({}));
    render(<WorkspaceTrustPanel />);
    expect(await screen.findByText(/runs no published release/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByTestId('trust')).toBeNull();
  });

  it('says the release could not be read, and reads it again on Try again', async () => {
    appsReportAll.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(
      report({
        package: { package: 'network.calimero.docs', version: '1.1.0' },
      }),
    );
    render(<WorkspaceTrustPanel />);
    expect(await screen.findByText(/could not read the release/i)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('trust')).textContent).toContain('1.1.0');
  });

  it('says what the section covers: the shared settings, not the documents', async () => {
    appsReportAll.mockResolvedValue(
      report({
        package: { package: 'network.calimero.docs', version: '1.1.0' },
      }),
    );
    render(<WorkspaceTrustPanel />);
    await screen.findByTestId('trust');
    expect(
      screen.getByText(
        /open a folder to check the code its documents run on, from the node shield/i,
      ),
    ).toBeTruthy();
  });

  it('keeps a visible Trust heading when there is no release and when it cannot be read', async () => {
    appsReportAll.mockResolvedValueOnce(report({}));
    const { unmount } = render(<WorkspaceTrustPanel />);
    await screen.findByText(/runs no published release/i);
    expect(screen.getByRole('heading', { name: 'Trust' })).toBeTruthy();
    unmount();
    appsReportAll.mockRejectedValueOnce(new Error('offline'));
    render(<WorkspaceTrustPanel />);
    await screen.findByText(/could not read the release/i);
    expect(screen.getByRole('heading', { name: 'Trust' })).toBeTruthy();
  });

  it('treats a running package without a version as no published release', async () => {
    appsReportAll.mockResolvedValue(
      report({ package: { package: 'network.calimero.docs' } }),
    );
    render(<WorkspaceTrustPanel />);
    expect(await screen.findByText(/runs no published release/i)).toBeTruthy();
    expect(screen.queryByTestId('trust')).toBeNull();
  });

  it('never shows the last workspace release for another registry instance', async () => {
    appsReportAll.mockResolvedValueOnce(
      report({
        package: { package: 'network.calimero.docs', version: '1.1.0' },
      }),
    );
    const view = render(<WorkspaceTrustPanel />);
    await screen.findByTestId('trust');
    let finish: (value: object) => void = () => {};
    appsReportAll.mockReturnValueOnce(new Promise((done) => (finish = done)));
    registry = 'reg-2';
    view.rerender(<WorkspaceTrustPanel />);
    expect(screen.queryByTestId('trust')).toBeNull();
    finish(
      report(
        { package: { package: 'network.calimero.docs', version: '2.0.0' } },
        'reg-2',
      ),
    );
    expect((await screen.findByTestId('trust')).textContent).toBe(
      'network.calimero.docs@2.0.0 for reg-2',
    );
  });
});
