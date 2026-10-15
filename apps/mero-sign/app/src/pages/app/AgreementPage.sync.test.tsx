// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// ── One agreement, opened right after joining its workspace ─────────────────
//
// An invitation to a workspace holding one agreement lands here, and this
// page's read of the agreement is what ends the invitation dialog's
// "Syncing…". Right after the join the node holds no state for the agreement
// yet and the read FAILS ("Uninitialized"); it used to be asked once, so the
// page showed that error for good and the gate waited out its watchdog.

const NAMESPACE = 'ns-1';
const CONTEXT = 'ctx-lease';

const getContextDetails = vi.fn();
vi.mock('../../api/dataSource/ClientApiDataSource', () => ({
  ClientApiDataSource: class {
    getContextDetails = getContextDetails;
    whoami = async () => ({ data: null });
  },
}));
vi.mock('../../api/dataSource/nodeApiDataSource', () => ({
  ContextApiDataSource: class {},
}));
vi.mock('../../api/documentService', () => ({
  DocumentService: class {
    listDocuments = async () => ({ data: [] });
  },
}));
vi.mock('../../lib/node', () => ({
  apiClient: {},
  blobClient: {},
  getExecutorPublicKey: () => null,
  setContextId: vi.fn(),
  setExecutorPublicKey: vi.fn(),
  // One handle for the life of the test: a new object per render would re-run
  // every effect keyed on it.
  useCalimero: () => app,
}));
const app = { app: {} };
vi.mock('../../lib/activeWorkspace', () => ({
  useActiveWorkspace: () => NAMESPACE,
}));
vi.mock('../../lib/inviteLink', () => ({ invitationUrl: () => '' }));
vi.mock('../../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/PDFViewer', () => ({ default: () => null }));

const { isNamespaceJustJoined, markNamespaceJustJoined } = await import(
  '@calimero-network/mero-react'
);
const { default: AgreementPage } = await import('./AgreementPage');

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/agreements/${CONTEXT}`]}>
      <Routes>
        <Route path="/agreements/:agreementId" element={<AgreementPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const syncing = { error: { code: 500, message: 'Uninitialized' } };
const lease = {
  data: { context_name: 'Lease', participant_count: 2, participants: [] },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getContextDetails.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe('AgreementPage after a join', () => {
  it('asks again while the agreement syncs, and settles on the first answer', async () => {
    markNamespaceJustJoined(NAMESPACE);
    getContextDetails
      .mockResolvedValueOnce(syncing)
      .mockResolvedValueOnce(syncing)
      .mockResolvedValue(lease);
    renderPage();

    await waitFor(() => expect(getContextDetails).toHaveBeenCalledTimes(1));
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);

    await vi.advanceTimersByTimeAsync(6_000);
    await waitFor(() => expect(isNamespaceJustJoined(NAMESPACE)).toBe(false));
    expect(await screen.findByText('Lease')).toBeTruthy();
    expect(screen.queryByTestId('error')).toBeNull();

    // Settled: no more asking.
    const calls = getContextDetails.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getContextDetails.mock.calls.length).toBe(calls);
  });

  it('asks once when the workspace was not just joined', async () => {
    getContextDetails.mockResolvedValue(syncing);
    renderPage();

    expect(await screen.findByTestId('error')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getContextDetails).toHaveBeenCalledTimes(1);
  });
});
