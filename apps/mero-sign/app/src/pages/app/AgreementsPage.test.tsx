// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { AgreementRow } from '../../lib/agreements';

// ── A workspace's agreements, right after joining it ────────────────────────
//
// The invitation dialog holds "Syncing…" until this page clears the joined
// namespace's flag. Right after the join the node holds the workspace but not
// its subgroups, so the listing comes back EMPTY (or fails) for a while: that
// is "not yet", and taking it as the answer closed the dialog on "No
// agreements yet" for the workspace the person was invited to sign something
// in, with nothing looking again. Once the flag has cleared, empty is an
// ordinary answer.

const NAMESPACE = 'ns-1';

const listAgreements = vi.fn<() => Promise<AgreementRow[]>>();
vi.mock('../../lib/agreements', async (importOriginal) => ({
  displayName: (await importOriginal<typeof import('../../lib/agreements')>())
    .displayName,
  listAgreements: () => listAgreements(),
  listWorkspaces: async () => [{ namespaceId: NAMESPACE }],
  workspaceTeeMode: async () => null,
  enterAgreement: vi.fn(),
}));
vi.mock('../../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/TeeBadge', () => ({ TeeBadge: () => null }));
vi.mock('../../lib/activeWorkspace', () => ({
  useActiveWorkspace: () => null,
  setActiveWorkspace: vi.fn(),
}));
vi.mock('../../hooks/useApplicationId', () => ({
  useApplicationId: () => ({ applicationId: 'app-1' }),
}));
vi.mock('../../lib/node', () => ({ adminApi: () => ({}) }));
// One handle for the life of the test: a new object per render would re-run
// every effect keyed on it.
const app = {};
vi.mock('../../lib/useCalimero', () => ({ useCalimero: () => ({ app }) }));
vi.mock('../../api/agreementService', () => ({
  AgreementService: class {},
}));

const { isNamespaceJustJoined, markNamespaceJustJoined } = await import(
  '@calimero-network/mero-react'
);
const { default: AgreementsPage } = await import('./AgreementsPage');

const lease: AgreementRow = {
  agreementId: 'sg-lease',
  name: 'Lease',
  contextId: 'ctx-lease',
  memberCount: 2,
  teeMode: null,
  joined: false,
  identity: null,
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/workspaces/${NAMESPACE}`]}>
      <Routes>
        <Route path="/workspaces/:workspaceId" element={<AgreementsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listAgreements.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('AgreementsPage after a join', () => {
  it('keeps looking while the workspace is empty, and stops at the first agreement', async () => {
    markNamespaceJustJoined(NAMESPACE);
    listAgreements
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Uninitialized'))
      .mockResolvedValueOnce([])
      .mockResolvedValue([lease]);
    renderPage();

    await waitFor(() => expect(listAgreements).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    // An empty read is not the answer yet: the dialog stays on "Syncing…".
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);
    expect(screen.queryByTestId('agreements-empty')).toBeNull();
    // Nor is a failed one an error to show.
    expect(screen.queryByTestId('list-error')).toBeNull();

    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(isNamespaceJustJoined(NAMESPACE)).toBe(false));
    expect(await screen.findByText('Lease')).toBeTruthy();

    // Settled: no more polling.
    const calls = listAgreements.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listAgreements.mock.calls.length).toBe(calls);
  });

  // An agreement's subgroup replicates before its context does, and a row with
  // no context cannot be opened. Settling on that closed the dialog with every
  // card disabled, and nothing re-read the list to enable them.
  it('keeps looking while the agreements listed cannot be opened yet', async () => {
    markNamespaceJustJoined(NAMESPACE);
    listAgreements
      .mockResolvedValueOnce([{ ...lease, contextId: null }])
      .mockResolvedValue([lease]);
    renderPage();

    await waitFor(() => expect(listAgreements).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);

    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(isNamespaceJustJoined(NAMESPACE)).toBe(false));
    expect(listAgreements.mock.calls.length).toBeGreaterThan(1);
  });

  it('waits past the base window while still empty, then says it is empty', async () => {
    markNamespaceJustJoined(NAMESPACE);
    listAgreements.mockResolvedValue([]);
    renderPage();

    // Past the 30s base window: still empty, so still waiting for the sync.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);
    expect(listAgreements.mock.calls.length).toBeGreaterThan(10);

    // The ceiling is what ends it, and then empty is the answer.
    await vi.advanceTimersByTimeAsync(65_000);
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(false);
    expect(await screen.findByTestId('agreements-empty')).toBeTruthy();
  });

  it('takes an empty workspace at its word when it was not just joined', async () => {
    listAgreements.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByTestId('agreements-empty')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listAgreements).toHaveBeenCalledTimes(1);
  });
});
