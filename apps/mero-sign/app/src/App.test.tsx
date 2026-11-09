// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  CalimeroError,
  type AppInfo,
  type CalimeroClient,
  type CalimeroSession,
} from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { APP } from './session';
import type { SessionDeps } from './session';
import { LIBRARY_NAME } from './lib/agreements';

// The landing page is generated and tested on its own; here it is the door.
vi.mock('./pages/landing/LandingPage', () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect
    </button>
  ),
}));
// pdf.js and the embedding model are not what these tests are about.
vi.mock('./components/PDFViewer', () => ({ default: () => null }));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

const ME = 'acct-alice';
const SESSION: CalimeroSession = {
  accountId: ME,
  sessionToken: 's',
  refreshToken: 'r',
  expiresAt: 9e12,
};
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const instance = (appId: string, name: string, org: string | null): AppInfo => ({
  appId,
  name,
  owner: ME,
  org,
  bundle: 'bundle-hash',
  package: null,
  version: null,
});

const AGREEMENT = instance('agr-1', 'Series A', 'org-1');
const LIBRARY = instance('lib-1', LIBRARY_NAME, null);

const DETAILS = {
  contextId: 'agr-1',
  contextName: 'Series A',
  owner: ME,
  isPrivate: false,
  participantCount: '1',
  participants: [{ userId: ME, permissionLevel: 'Admin' }],
  documentCount: '1',
  createdAt: '1700000000000',
};

const DOC = {
  id: 'doc_1',
  name: 'Term sheet.pdf',
  hash: 'h',
  uploadedBy: ME,
  uploadedAt: '1700000000000',
  status: 'Pending',
  pdfBlobId: 'ab'.repeat(32),
  size: '2048',
  requiredSigners: [ME],
  embeddings: null,
  extractedText: null,
  chunks: null,
};

function fakeClient() {
  let session: CalimeroSession | undefined;
  let next = 0;
  return {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({
      orgs: [{ orgId: 'org-1', name: 'Acme Legal', role: 'owner' }],
    })),
    getOrg: vi.fn(async () => ({
      name: 'Acme Legal',
      members: { [ME]: 'owner', 'acct-bob': 'member' },
    })),
    listApps: vi.fn(async () => [AGREEMENT, LIBRARY]),
    createApp: vi.fn(async () => `new-${++next}`),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === 'listParticipants'
          ? [ME]
          : method === 'getContextDetails'
            ? DETAILS
            : method === 'listDocuments'
              ? [DOC]
              : method === 'whoami'
                ? ME
                : method === 'isDefaultPrivateContext'
                  ? true
                  : null,
    })),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** A session an earlier visit left behind. */
function remember() {
  const store = new SessionStore(APP, resolveTarget(DEV_ENV));
  store.sync({ session: SESSION } as unknown as CalimeroClient);
}

describe('App', () => {
  it('signs in with a passkey from the landing page and lands on the workspaces', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Connect'));
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    await screen.findByText('Acme Legal');
    expect(client.signIn).toHaveBeenCalled();
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' }));
    // One agreement in it, two people in the org.
    expect(screen.getByText(/1 agreement/)).toBeTruthy();
  });

  it('lists a workspace’s agreements and creates one: the instance in the org, then its setup', async () => {
    remember();
    window.history.replaceState(null, '', '/workspaces/org-1');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByText('Series A');
    fireEvent.change(screen.getByTestId('new-agreement-name'), {
      target: { value: 'NDA' },
    });
    fireEvent.click(screen.getByTestId('create-agreement'));
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith('NDA', 'bundle-hash', { org: 'org-1' }),
    );
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('new-1', 'setup', {
        isPrivate: false,
        contextName: 'NDA',
      }),
    );
    // Recorded in the private library the account already has.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('lib-1', 'joinSharedContext', {
        contextIdStr: 'new-1',
        sharedIdentityStr: ME,
        contextName: 'NDA',
      }),
    );
  });

  it('opens an agreement and shows its documents in the screens’ shapes', async () => {
    remember();
    window.history.replaceState(null, '', '/agreements/agr-1');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await waitFor(() =>
      expect(screen.getByTestId('agreement-title').textContent).toBe('Series A'),
    );
    await screen.findByText('Term sheet.pdf');
    expect(client.view).toHaveBeenCalledWith('agr-1', 'getContextDetails', {
      contextIdStr: 'agr-1',
    });
  });

  it('signed out with a pending invite, shows the invitation page instead of the landing page', async () => {
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: null }),
    );
    render(<App deps={deps(fakeClient())} />);
    const page = await screen.findByTestId('invitation-page');
    expect(page.textContent).toContain("You're invited");
    expect(page.textContent).toContain('Sign in or create an account to accept');
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('signing in on the invitation page goes straight to the join prompt, then into the workspace', async () => {
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: null }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByTestId('invitation-page');
    fireEvent.click(screen.getByTestId('signin-passkey'));
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/org-1'));
    expect(screen.queryByTestId('invitation-page')).toBeNull();
  });

  it('"Not now" on the invitation page shows the landing page and keeps the token', async () => {
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: null }),
    );
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId('invitation-not-now'));
    await screen.findByText('Connect');
    expect(localStorage.getItem('mero-sign:pending-invite')).not.toBeNull();
  });

  it('does not redeem an invite into a workspace the account is already in', async () => {
    remember();
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: null, org: 'org-1' }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByTestId('invitation-member');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem('mero-sign:pending-invite')).toBeNull();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    remember();
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: null }),
    );
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(
      new CalimeroError(404, 'NOT_FOUND', 'unknown invite'),
    );
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    expect((await screen.findByTestId('invitation-error')).textContent).toBe(
      'This invite was already used or has expired. Ask the person who invited you for a new link.',
    );
    expect(localStorage.getItem('mero-sign:pending-invite')).toBeNull();
  });

  it('asks before redeeming an invitation, then joins the agreement the link names', async () => {
    remember();
    localStorage.setItem(
      'mero-sign:pending-invite',
      JSON.stringify({ token: 'tok-1', agreement: 'agr-1' }),
    );
    const client = fakeClient();
    client.view.mockImplementation(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === 'listParticipants'
          ? []
          : method === 'getContextDetails'
            ? DETAILS
            : method === 'isDefaultPrivateContext'
              ? true
              : method === 'whoami'
                ? ME
                : method === 'listDocuments'
                  ? []
                  : null,
    }));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-1'));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('agr-1', 'registerSelfAsParticipant', {}),
    );
    await screen.findByTestId('agreement-title');
    expect(localStorage.getItem('mero-sign:pending-invite')).toBeNull();
  });
});
