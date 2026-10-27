import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from '@calimero-apps/cloud';

// ── A team this session just joined ─────────────────────────────────────────
//
// Right after the join the node may not hold the team's vaults yet: the
// subgroup list comes back empty, or the read fails outright, and a vault can
// be listed before its context has arrived. None of those is the team's real
// answer, so none may settle the join-sync gate (which closes the invitation
// dialog onto "No vaults in this team yet" and an invitation to create a
// duplicate); the page re-reads until the vaults land.

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
  useParams: () => ({ teamId: 'ns-1' }),
}));

const stub = vi.hoisted(() => {
  const node = {
    subgroups: [] as { groupId: string }[] | Error,
    contexts: {} as Record<string, { contextId: string }[]>,
  };
  const admin = {
    listNamespacesForApplication: vi.fn(async () => [
      { namespaceId: 'ns-1', name: 'Acme' },
    ]),
    listNamespaceGroups: vi.fn(async () => {
      if (node.subgroups instanceof Error) throw node.subgroups;
      return node.subgroups;
    }),
    listGroupContexts: vi.fn(async (id: string) => node.contexts[id] ?? []),
    listGroupMembers: vi.fn(async () => ({ members: [] as unknown[] })),
    getGroupMetadata: vi.fn(async () => ({ name: 'Shared logins' })),
    getSubgroupVisibility: vi.fn(async () => 'open'),
    getContextIdentitiesOwned: vi.fn(async () => ({
      identities: [] as string[],
    })),
  };
  const session = {
    mero: { admin, rpc: {} },
    admin,
    isDelegated: false,
    applicationId: 'app-registry',
    isAuthenticated: true,
    isLoading: false,
    logout: () => {},
    nodeUrl: null,
  };
  return { node, admin, session };
});

vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => stub.session,
}));

vi.mock('../../hooks/useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app-registry',
    resolving: false,
    notInstalled: false,
  }),
}));

vi.mock('../../hooks/useTeamCapabilities', async () => {
  const { MEMBER_CAPABILITIES } = await import('../../lib/roles');
  return {
    useTeamCapabilities: () => ({
      accountId: 'a'.repeat(64),
      capabilities: MEMBER_CAPABILITIES,
      loading: false,
      refetch: async () => {},
    }),
  };
});

vi.mock('../../components/MembersPanel', () => ({ default: () => null }));

import TeamPage from './TeamPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams/ns-1']}>
      <TeamPage />
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  stub.node.subgroups = [];
  stub.node.contexts = {};
  markNamespaceJustJoined('ns-1');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeamPage right after joining the team', () => {
  it('does not settle on an empty vault list, and re-reads until the vaults arrive', async () => {
    renderPage();
    await advance(100);
    expect(screen.queryByTestId('vaults-empty')).not.toBeInTheDocument();
    expect(isNamespaceJustJoined('ns-1')).toBe(true);

    stub.node.subgroups = [{ groupId: 'sub-a' }];
    stub.node.contexts = { 'sub-a': [{ contextId: 'ctx-a' }] };
    await advance(2_500);

    expect(await screen.findByTestId('vault-card')).toBeEnabled();
    expect(isNamespaceJustJoined('ns-1')).toBe(false);
  });

  it('retries a read that fails because the team has not synced yet', async () => {
    stub.node.subgroups = new Error('namespace not found');
    renderPage();
    await advance(100);
    expect(isNamespaceJustJoined('ns-1')).toBe(true);

    stub.node.subgroups = [{ groupId: 'sub-a' }];
    stub.node.contexts = { 'sub-a': [{ contextId: 'ctx-a' }] };
    await advance(2_500);

    expect(await screen.findByTestId('vault-card')).toBeEnabled();
  });

  it('re-reads a vault listed before its context arrived', async () => {
    stub.node.subgroups = [{ groupId: 'sub-a' }];
    renderPage();
    expect(await screen.findByTestId('vault-card')).toBeDisabled();

    stub.node.contexts = { 'sub-a': [{ contextId: 'ctx-a' }] };
    await advance(2_500);

    expect(await screen.findByTestId('vault-card')).toBeEnabled();
  });

  it('shows a genuinely empty team as empty once the gate expires', async () => {
    renderPage();
    await advance(125_000);
    expect(await screen.findByTestId('vaults-empty')).toBeInTheDocument();
    expect(isNamespaceJustJoined('ns-1')).toBe(false);
  });
});
