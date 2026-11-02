// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { fakeConn } from './test/fakeClient';
import { WORKSPACE_KIND } from './lib/agreements';

// The screens on a mocked `CalimeroClient`: what they ask the cluster and
// what they show from its answers. The shell is stubbed (it reads the session
// for its header only).

const HASH = 'ab'.repeat(32);
let conn = fakeConn();
vi.mock('./lib/useCalimero', () => ({
  useCalimero: () => ({ app: conn, isAuthenticated: true, accountId: conn.accountId, login: vi.fn(), logout: vi.fn() }),
}));
vi.mock('./components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: WorkspacesPage } = await import('./pages/app/WorkspacesPage');
const { default: AgreementsPage } = await import('./pages/app/AgreementsPage');
const { default: AgreementPage } = await import('./pages/app/AgreementPage');

afterEach(cleanup);

function at(path: string, element: ReactNode, pattern: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the workspaces screen', () => {
  it('lists the workspaces and creates one as an org', async () => {
    conn = fakeConn();
    conn.fake.me.mockResolvedValue({ orgs: [{ orgId: 'org-a', name: 'Acme', role: 'owner' }] });
    conn.fake.getOrg.mockResolvedValue({ name: 'Acme', members: { 'acct-me': 'owner' }, metadata: { kind: WORKSPACE_KIND } });
    at('/workspaces', <WorkspacesPage />, '/workspaces');
    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(screen.getByText(/0 agreements/)).toBeTruthy();

    fireEvent.change(screen.getByTestId('new-workspace-name'), { target: { value: 'Deal' } });
    fireEvent.click(screen.getByTestId('create-workspace'));
    await waitFor(() => expect(conn.fake.createOrg).toHaveBeenCalledWith('Deal'));
  });
});

describe('the agreements screen', () => {
  it("lists the workspace's agreements and opens one by registering", async () => {
    conn = fakeConn({
      getContextDetails: { contextName: 'NDA', participants: [] },
      getUserPermission: Object.assign(new Error('no'), { appCode: 'NotFound' }),
      registerSelfAsParticipant: null,
    });
    conn.fake.listApps.mockResolvedValue([
      { appId: 'app-nda', name: 'NDA', owner: 'acct-x', org: 'org-a', bundle: 'b', package: null, version: null },
    ]);
    at('/workspaces/org-a', <AgreementsPage />, '/workspaces/:workspaceId');
    const card = await screen.findByText('NDA');
    fireEvent.click(card);
    await waitFor(() =>
      expect(conn.fake.call).toHaveBeenCalledWith('app-nda', 'registerSelfAsParticipant', {}),
    );
    expect(await screen.findByText('elsewhere')).toBeTruthy();
  });
});

describe('the agreement screen', () => {
  it('shows the agreement, its people and its documents', async () => {
    conn = fakeConn({
      getContextDetails: {
        contextId: 'app-nda',
        contextName: 'Series A',
        owner: 'acct-me',
        isPrivate: false,
        participantCount: '2',
        participants: [
          { userId: 'acct-me', permissionLevel: 'Admin' },
          { userId: 'acct-bob', permissionLevel: 'Sign' },
        ],
        documentCount: '1',
        createdAt: '1',
      },
      listDocuments: {
        items: [
          {
            id: 'doc_1',
            name: 'term-sheet.pdf',
            hash: HASH,
            uploadedBy: 'acct-me',
            uploadedAt: '1700000000000',
            status: 'PartiallySigned',
            pdfBlobId: HASH,
            size: '2048',
            requiredSigners: ['acct-me', 'acct-bob'],
            originalHash: HASH,
          },
        ],
        next: null,
      },
    });
    conn.fake.getApp.mockResolvedValue({ org: 'org-a' });
    conn.fake.getOrg.mockResolvedValue({
      name: 'Acme',
      members: {},
      memberMetadata: { 'acct-bob': { name: 'Bob' } },
    });
    at('/agreements/app-nda', <AgreementPage />, '/agreements/:agreementId');
    expect(await screen.findByTestId('agreement-title')).toHaveProperty('textContent', 'Series A');
    expect(await screen.findByText('term-sheet.pdf')).toBeTruthy();
    expect(conn.fake.view).toHaveBeenCalledWith('app-nda', 'listDocuments', { limit: 1000 });

    fireEvent.click(screen.getByTestId('tab-people'));
    expect(await screen.findByText('Bob')).toBeTruthy();
  });
});
