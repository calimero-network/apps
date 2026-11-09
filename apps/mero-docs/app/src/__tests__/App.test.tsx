// The app on a mocked CalimeroClient: passkey sign-in, a workspace (an org)
// with its registry, a folder (a team) with its docs instance, a document in
// it, and an invitation redeemed after sign-in.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession, type CloudEvent } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { APP, type SessionDeps } from '@/calimero/session';

// The landing page is generated and tested on its own; here it is the door.
vi.mock('@/pages/landing/LandingPage', () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Open sign-in
    </button>
  ),
}));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as Record<string, unknown>;
  g.IntersectionObserver ??= Observer;
  g.ResizeObserver ??= Observer;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as never;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

const ME = 'acct-alice';
const SESSION: CalimeroSession = { accountId: ME, sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 } as CalimeroSession;
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const REGISTRY: AppInfo = { appId: 'reg-1', name: 'Registry', owner: ME, org: 'org-1', bundle: 'bundle-hash', package: null, version: null };
const ORG = {
  orgId: 'org-1',
  name: 'Acme',
  members: { [ME]: 'owner', 'acct-bob': 'member' },
  defaultCapabilities: 37,
  capabilities: {},
  metadata: { registryApp: 'reg-1' },
  memberMetadata: { [ME]: { name: 'Alice' }, 'acct-bob': { name: 'Bob' } },
  teams: {
    eng: {
      teamId: 'eng',
      name: 'Engineering',
      join: 'everyone',
      members: { [ME]: true },
      readOnly: [],
      capabilities: {},
      metadata: { docsApp: 'docs-eng', color: '#3b82f6' },
      removed: [],
    },
  },
};
const DOC = {
  id: 'doc-1',
  title: 'Launch plan',
  tags: [],
  archived: false,
  createdAt: String(Date.now() - 60_000),
  updatedAt: String(Date.now() - 30_000),
  createdBy: ME,
  updatedBy: ME,
  canDelete: true,
};

/** An endless stream, until the hook that opened it lets go. */
async function* idle(signal?: AbortSignal): AsyncGenerator<CloudEvent> {
  await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
  yield* [];
}

function fakeClient() {
  let session: CalimeroSession | undefined;
  const views: Record<string, unknown> = {
    getOwner: ME,
    listManagers: [],
    listTags: [],
    listViews: [],
    listDocs: [DOC],
    getDoc: DOC,
    searchDocs: { hits: [], total: '0', nextCursor: null },
  };
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
    me: vi.fn(async () => ({ orgs: [{ orgId: 'org-1', name: 'Acme', role: 'owner' }] })),
    getOrg: vi.fn(async () => ORG),
    listApps: vi.fn(async () => [REGISTRY]),
    call: vi.fn(async () => ({ index: 2, result: 'doc-2', events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: views[method] ?? null })),
    events: vi.fn((_app: string, _from: number, signal?: AbortSignal) => idle(signal)),
    presenceStream: vi.fn((_app: string, signal?: AbortSignal) => idle(signal)),
    publishPresence: vi.fn(async () => undefined),
    redeemInvite: vi.fn(async () => ({ orgId: 'org-1' })),
    setMemberMetadata: vi.fn(async () => undefined),
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }) as never,
  };
}

/**
 * Waits that sit behind the whole boot chain (session → me → org → apps →
 * views). Fast locally, but CI runs every app's tests at once and the chain
 * has taken ~2s there, past testing-library's 1s default.
 */
const BOOT = { timeout: 10_000 };

/** A session an earlier visit left behind. */
function remember() {
  new SessionStore(APP, resolveTarget(DEV_ENV)).sync({ session: SESSION } as unknown as CalimeroClient);
}

describe('App on Calimero 1.0', () => {
  it('signs in with a passkey and opens the workspace with its folders', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Open sign-in'));
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled(), BOOT);
    expect((await screen.findAllByText('Engineering', {}, BOOT)).length).toBeGreaterThan(0);
    // The workspace is the org; its registry is the instance its metadata names.
    expect(client.getOrg).toHaveBeenCalledWith('org-1');
    expect(client.view).toHaveBeenCalledWith('reg-1', 'getOwner', {});
  });

  it('lists a folder’s documents from its docs instance', async () => {
    remember();
    window.history.replaceState(null, '', '/app/org-1/f/eng');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect((await screen.findAllByText('Launch plan', {}, BOOT)).length).toBeGreaterThan(0);
    expect(client.view).toHaveBeenCalledWith('docs-eng', 'listDocs', { includeArchived: true });
  });

  it('asks before redeeming an invitation, then redeems the org invite token', async () => {
    remember();
    localStorage.setItem(
      'mero-docs:pending-invite',
      JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2', targetName: 'Beta' }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('invite-accept', {}, BOOT)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('inv_abc'));
    expect(localStorage.getItem('mero-docs:pending-invite')).toBeNull();
  });

  it('does not offer Join to someone already in the workspace, and keeps the link unspent', async () => {
    remember();
    localStorage.setItem(
      'mero-docs:pending-invite',
      JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-1', workspaceId: 'org-1', targetName: 'Acme' }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('invite-already-member', {}, BOOT)).toBeTruthy();
    expect(screen.queryByTestId('invite-accept')).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem('mero-docs:pending-invite')).toBeNull();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    remember();
    localStorage.setItem(
      'mero-docs:pending-invite',
      JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2' }),
    );
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invite-accept', {}, BOOT));
    expect((await screen.findByTestId('invite-error')).textContent).toBe(
      'This invite was already used or has expired. Ask the person who invited you for a new link.',
    );
    expect(localStorage.getItem('mero-docs:pending-invite')).toBeNull();
  });

  describe('an invitation link opened while signed out', () => {
    const invite = JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2', targetName: 'Beta' });

    it('shows the invitation as the page, not the landing hero', async () => {
      localStorage.setItem('mero-docs:pending-invite', invite);
      render(<App deps={deps(fakeClient())} />);
      expect(await screen.findByTestId('invitation-page', {}, BOOT)).toBeTruthy();
      expect(screen.getByText("You're invited")).toBeTruthy();
      expect(screen.getByTestId('signin-desc').textContent).toContain(
        "You've been invited to join a workspace “Beta” in Mero Docs.",
      );
      expect(screen.getByTestId('signin-passkey')).toBeTruthy();
      expect(screen.getByTestId('signup-passkey')).toBeTruthy();
      expect(screen.queryByText('Open sign-in')).toBeNull();
    });

    it('signing in goes straight to the join prompt, then into the workspace', async () => {
      localStorage.setItem('mero-docs:pending-invite', invite);
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId('signin-passkey', {}, BOOT));
      fireEvent.click(await screen.findByTestId('invite-accept', {}, BOOT));
      await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('inv_abc'));
      await waitFor(() => expect(window.location.pathname).toBe('/app/org-1'), BOOT);
    });

    it('Not now shows the landing page and keeps the token', async () => {
      localStorage.setItem('mero-docs:pending-invite', invite);
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByTestId('invitation-not-now', {}, BOOT));
      fireEvent.click(await screen.findByText('Open sign-in'));
      expect((await screen.findByTestId('signin-desc')).textContent).toContain("You've been invited");
      expect(localStorage.getItem('mero-docs:pending-invite')).not.toBeNull();
    });
  });
});
