import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── One team, on an ACCOUNT (a delegated session) ───────────────────────────
//
// Two things are proven here. First, that creating a vault — a subgroup and
// its context — goes through the session-aware `useMero().admin` and never
// the raw client's admin, which is the relay's node route and a 403 for an
// account (`POST /admin-api/contexts` on prod). Second, that the half of
// invite-only vaults an account cannot do is not offered: a subgroup
// invitation has no account form in mero-react (`createGroupInvitation` and
// `joinGroup` are a node's operations), so the "Invite-only" toggle is hidden
// and so is the per-vault invite on a vault that already is invite-only. An
// OPEN vault's invite is a team invitation with routing hints, which an
// account can mint, so that one stays.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
  useParams: () => ({ teamId: 'ns-1' }),
}));

const stub = vi.hoisted(() => {
  const spy = <T,>(result: T) => vi.fn(async () => result);
  const vaults = [{ groupId: 'sub-open' }, { groupId: 'sub-locked' }];
  const admin = {
    listNamespacesForApplication: spy([{ namespaceId: 'ns-1', name: 'Acme' }]),
    getGroupMetadata: vi.fn(async (id: string) =>
      id === 'sub-open'
        ? { name: 'Shared logins' }
        : id === 'sub-locked'
          ? { name: 'Board only' }
          : null,
    ),
    listNamespaceGroups: spy(vaults),
    listGroupContexts: vi.fn(async (id: string) => [
      { contextId: `ctx-${id}` },
    ]),
    listGroupMembers: spy({ members: [] as unknown[] }),
    getSubgroupVisibility: vi.fn(async (id: string) =>
      id === 'sub-locked' ? 'restricted' : 'open',
    ),
    getContextIdentitiesOwned: spy({ identities: [] as string[] }),
    createGroupInNamespace: spy({ groupId: 'sub-new' }),
    setGroupMetadata: spy(undefined),
    setSubgroupVisibility: spy(undefined),
    createContext: spy({ contextId: 'ctx-new', memberPublicKey: '' }),
  };
  const rawAdmin = {
    createGroupInNamespace: vi.fn(),
    createContext: vi.fn(),
    listNamespaceGroups: vi.fn(),
  };
  const session = {
    mero: { admin: rawAdmin, rpc: {} },
    admin,
    isDelegated: true,
    applicationId: 'app-registry',
    isAuthenticated: true,
    isLoading: false,
    logout: () => {},
    nodeUrl: null,
  };
  return { admin, rawAdmin, session };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => stub.session,
}));

vi.mock('../../hooks/useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app-registry',
    resolving: false,
    notInstalled: false,
  }),
}));

// This account is an Admin of the team: every control is on the screen, so
// what is NOT rendered below is hidden by the session, not by the role.
vi.mock('../../hooks/useTeamCapabilities', async () => {
  const { ADMIN_CAPABILITIES } = await import('../../lib/roles');
  return {
    useTeamCapabilities: () => ({
      accountId: 'a'.repeat(64),
      capabilities: ADMIN_CAPABILITIES,
      loading: false,
      refetch: async () => {},
    }),
  };
});

vi.mock('@calimero-apps/join-sync', () => ({
  useJoinSync: () => ({ isSyncing: false, dismiss: () => {} }),
  JoinSyncBanner: () => null,
}));

vi.mock('../../components/MembersPanel', () => ({ default: () => null }));

import TeamPage from './TeamPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams/ns-1']}>
      <TeamPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  for (const fn of Object.values(stub.rawAdmin)) fn.mockClear();
  for (const fn of Object.values(stub.admin)) fn.mockClear();
});

describe('TeamPage on a delegated session', () => {
  it('lists the vaults through the account admin and offers no "Invite-only" toggle', async () => {
    renderPage();
    const cards = await screen.findAllByTestId('vault-card');
    expect(cards).toHaveLength(2);
    expect(stub.admin.listNamespaceGroups).toHaveBeenCalledWith('ns-1');
    expect(stub.rawAdmin.listNamespaceGroups).not.toHaveBeenCalled();
    // The create row is up (this account is an Admin)…
    expect(screen.getByTestId('vault-create')).toBeInTheDocument();
    // …without the toggle an account could not follow through on.
    expect(screen.queryByTestId('vault-restricted')).not.toBeInTheDocument();
  });

  it('creates a vault — subgroup and context — through the account admin, open', async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId('vault-name'), {
      target: { value: 'Production keys' },
    });
    fireEvent.click(screen.getByTestId('vault-create'));
    await waitFor(() => expect(stub.admin.createContext).toHaveBeenCalled());

    expect(stub.admin.createGroupInNamespace).toHaveBeenCalledWith('ns-1', {
      groupName: 'Production keys',
      visibility: 'open',
    });
    expect(stub.admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-registry',
        groupId: 'sub-new',
      }),
    );
    expect(stub.rawAdmin.createGroupInNamespace).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createContext).not.toHaveBeenCalled();
  });

  it('offers the invite on an open vault but not on an invite-only one', async () => {
    renderPage();
    await screen.findAllByTestId('vault-card');
    const invites = screen.getAllByTestId('vault-invite');
    expect(invites).toHaveLength(1);
    expect(invites[0]).toHaveAttribute(
      'aria-label',
      'Invite someone to Shared logins',
    );
  });
});
