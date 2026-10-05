import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── The teams screen on an ACCOUNT (a delegated session) ────────────────────
//
// The raw client's admin (`useMero().mero.admin`) is the relay's node route
// under the account's bearer token, and on prod every call on this screen
// answered 403: `GET /admin-api/applications`, `GET /admin-api/namespaces/
// for-application/{app}`, `POST /admin-api/namespaces`, the invitation, the
// join. The screen rendered "Mero Pass is not installed on this node". The
// page must list, create and join through the session-aware `useMero().admin`
// — the account admin — and the raw client must never be reached. These run
// the REAL `lib/vaults` against a fake session admin, so what is proven is
// the whole path from the button to the admin call.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

import { ADMIN_CAPABILITIES } from '../../lib/roles';

const stub = vi.hoisted(() => {
  const spy = <T,>(result: T) => vi.fn(async () => result);
  // The session-aware admin: on an account, mero-react's account admin.
  const admin = {
    listNamespacesForApplication: spy([] as unknown[]),
    getGroupMetadata: spy(null as unknown),
    listNamespaceGroups: spy([] as unknown[]),
    createNamespace: vi.fn(async () => ({
      namespaceId: 'ns-new',
      haEnabled: false,
      haError: 'link this account to your cloud user in the wallet',
    })),
    setGroupMetadata: spy(undefined),
    setDefaultCapabilities: spy(undefined),
    setMemberCapabilities: spy(undefined),
    // Every bit set: `createTeam` re-reads the creator's mask after granting
    // Admin and refuses a grant the node did not apply.
    getMemberCapabilities: vi.fn(async () => ({ capabilities: 0xffff })),
    setSubgroupVisibility: spy(undefined),
    createGroupInNamespace: spy({ groupId: 'sub-new' }),
    createContext: spy({ contextId: 'ctx-new', memberPublicKey: '' }),
  };
  // The RAW client's admin: the node route, a 403 for an account. These spies
  // exist to prove the page never reaches it.
  const rawAdmin = {
    listApplications: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    createNamespace: vi.fn(),
    createContext: vi.fn(),
    joinNamespace: vi.fn(),
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
  const identity = { identity: { accountId: 'a'.repeat(64) } };
  return { admin, rawAdmin, session, identity };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => stub.session,
  useNodeIdentity: () => stub.identity,
}));

// On an account the id is the registry's, via the provider (see
// `useApplicationId.session.test`). Stubbed so this suite is about the page.
vi.mock('../../hooks/useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app-registry',
    resolving: false,
    notInstalled: false,
  }),
}));

import TeamsPage from './TeamsPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams']}>
      <TeamsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  for (const fn of Object.values(stub.rawAdmin)) fn.mockClear();
  for (const fn of Object.values(stub.admin)) fn.mockClear();
});

describe('TeamsPage on a delegated session', () => {
  it('lists teams through the account admin, never the raw client', async () => {
    renderPage();
    await waitFor(() =>
      expect(stub.admin.listNamespacesForApplication).toHaveBeenCalledWith(
        'app-registry',
      ),
    );
    expect(screen.queryByTestId('not-installed')).not.toBeInTheDocument();
    expect(stub.rawAdmin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it('creates a team through the account admin and carries the hosting refusal to the team screen', async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId('team-name'), {
      target: { value: 'Acme' },
    });
    fireEvent.click(screen.getByTestId('team-create'));
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(stub.admin.createNamespace).toHaveBeenCalledWith({
      applicationId: 'app-registry',
      name: 'Acme',
    });
    // The creator is granted Admin by the same client.
    expect(stub.admin.setMemberCapabilities).toHaveBeenCalledWith(
      'ns-new',
      'a'.repeat(64),
      { capabilities: ADMIN_CAPABILITIES },
    );
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    // The team exists; what the cloud refused is HOSTING it, and the team
    // screen is told so right away rather than the first invitation failing.
    expect(navigate).toHaveBeenCalledWith('/teams/ns-new', {
      state: {
        hostingNotice: 'link this account to your cloud user in the wallet',
      },
    });
  });

  it('creates the private vault — namespace AND context — through the account admin', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('personal-create'));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/vault/ctx-new'),
    );

    expect(stub.admin.createNamespace).toHaveBeenCalledTimes(1);
    expect(stub.admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-registry',
        groupId: 'sub-new',
      }),
    );
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createContext).not.toHaveBeenCalled();
  });
});
