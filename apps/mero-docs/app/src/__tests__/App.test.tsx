// The app on a mocked CalimeroClient: passkey sign-in, a workspace (an org)
// with its registry, a folder (a team) with its docs instance, a document in
// it, and an invitation redeemed after sign-in.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  CalimeroError,
  type AppInfo,
  type CalimeroClient,
  type CalimeroSession,
  type CloudEvent,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { SIGN_IN_HINT, SIGN_UP_NOT_FINISHED, accountHintKey, noAccountCopy } from '@calimero-apps/passkey';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { APP, type SessionDeps } from '@/calimero/session';
import { buildInviteUrl, invites, migrateLegacyInvite } from '@/hooks/useNamespaceInvitation';

// `useInstanceRelease` as on a page a node serves from `release.href` (a
// release's `/{version}/`), going nowhere but `release.navigate`. With no
// `href` it reads this test's own location: development, where it never moves.
const release = vi.hoisted(() => ({ href: null as string | null, navigate: vi.fn() }));
vi.mock('@calimero-apps/passkey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-apps/passkey')>();
  return {
    ...actual,
    useInstanceRelease: (...[client, app]: Parameters<typeof actual.useInstanceRelease>) =>
      actual.useInstanceRelease(client, app, release.href ? { href: release.href, navigate: release.navigate } : {}),
  };
});
const HOST = `https://${'a'.repeat(52)}.apps.calimero.network`;

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
function hold(legacy: string) {
  localStorage.setItem('mero-docs:pending-invite', legacy);
  migrateLegacyInvite();
}

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
  release.href = null;
  release.navigate.mockClear();
  invites.drop();
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
    hold(JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2', targetName: 'Beta' }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('invite-accept', {}, BOOT)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('inv_abc'));
    expect(invites.token()).toBeNull();
  });

  it('does not offer Join to someone already in the workspace, and keeps the link unspent', async () => {
    remember();
    hold(JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-1', workspaceId: 'org-1', targetName: 'Acme' }),
    );
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('invite-already-member', {}, BOOT)).toBeTruthy();
    expect(screen.queryByTestId('invite-accept')).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    remember();
    hold(JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2' }),
    );
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invite-accept', {}, BOOT));
    expect((await screen.findByTestId('invite-error')).textContent).toBe(
      'This invite was already used or has expired. Ask the person who invited you for a new link.',
    );
    expect(invites.token()).toBeNull();
  });

  it('an invited newcomer who creates the account lands in the folder the link names (B10)', async () => {
    const link = new URL(buildInviteUrl('group', 'inv_f', { workspace: 'org-1', folder: 'eng' }, 'Engineering'));
    window.history.replaceState(null, '', `${link.pathname}${link.search}`);
    invites.capture(window.location);
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('signup-passkey', {}, BOOT));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'inv_f' }), BOOT);
    await waitFor(() => expect(window.location.pathname).toBe('/app/org-1/f/eng'), BOOT);
    expect((await screen.findAllByText('Launch plan', {}, BOOT)).length).toBeGreaterThan(0);
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  }, 20_000);

  it.each([
    [429, 'RATE_LIMITED', /invite is kept/],
    [401, 'UNAUTHENTICATED', /invite is kept/],
  ])('keeps the invite when redeeming answers %i, and says to try again (B6)', async (status, code, says) => {
    remember();
    hold(JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2' }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, 'not now'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invite-accept', {}, BOOT));
    expect((await screen.findByTestId('invite-error')).textContent).toMatch(says);
    expect(invites.token()).toBe('inv_abc');
    expect(screen.getByTestId('invite-accept')).toBeTruthy();
  });

  describe("a sign-up's second prompt", () => {
    // Since core #4849 a sign-up takes two prompts. The second is asked right
    // after the first; it waits for Approve only when that failed or was refused
    // (a blocked prompt, Safari's user-gesture rule, a closed prompt).
    function signUpWith(get: PasskeyProvider['get']) {
      const client = fakeClient();
      const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
      client.signUp.mockImplementation((async (p: PasskeyProvider) => {
        await p.create({} as never);
        await p.get(new Uint8Array([1]), 'example.com', ['new-cred']);
        return client.signIn();
      }) as never);
      const d = { ...deps(client), passkey: () => pk as unknown as PasskeyProvider };
      return { client, pk, d };
    }
    const notAllowed = (message = 'The request is not allowed by the user agent.') =>
      Object.assign(new Error(message), { name: 'NotAllowedError' });
    async function startSignUp(d: SessionDeps) {
      render(<App deps={d} />);
      fireEvent.click(await screen.findByText('Open sign-in'));
      fireEvent.click(await screen.findByTestId('signup-passkey'));
    }
    /** "Approve with your new passkey", once the sign-up has fallen back to it. */
    async function approveButton() {
      const approve = await screen.findByTestId('signup-approve');
      await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
      expect(approve.textContent).toBe('Approve with your new passkey');
      return approve;
    }

    it('asks both prompts back to back, with no click, then opens the workspace', async () => {
      const { client, pk, d } = signUpWith(async () => ({}) as never);
      await startSignUp(d);
      expect((await screen.findAllByText('Engineering', {}, BOOT)).length).toBeGreaterThan(0);
      expect(pk.create).toHaveBeenCalledTimes(1);
      expect(pk.get).toHaveBeenCalledTimes(1);
      expect(client.signUp).toHaveBeenCalledTimes(1);
    });

    it('a second prompt refused at once waits for Approve, which then opens the workspace', async () => {
      const { pk, d } = signUpWith(async () => {
        if (pk.get.mock.calls.length === 1) throw notAllowed();
        return {} as never;
      });
      await startSignUp(d);
      const approve = await approveButton();
      expect(pk.get).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('signin-error')).toBeNull();
      fireEvent.click(approve);
      expect((await screen.findAllByText('Engineering', {}, BOOT)).length).toBeGreaterThan(0);
      expect(pk.get).toHaveBeenCalledTimes(2);
    });

    it('a second prompt the person saw and closed shows the error with Approve, which then opens the workspace', async () => {
      const { pk, d } = signUpWith(async () => {
        if (pk.get.mock.calls.length > 1) return {} as never;
        await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
        throw notAllowed('The operation either timed out or was not allowed.');
      });
      await startSignUp(d);
      expect((await screen.findByTestId('signin-error', {}, { timeout: 3000 })).textContent).toBe(SIGN_UP_NOT_FINISHED);
      fireEvent.click(await approveButton());
      expect((await screen.findAllByText('Engineering', {}, BOOT)).length).toBeGreaterThan(0);
      expect(pk.get).toHaveBeenCalledTimes(2);
    });

    it('shows a second prompt refused after Approve and keeps Approve', async () => {
      const { pk, d } = signUpWith(async () => {
        if (pk.get.mock.calls.length === 1) throw notAllowed();
        await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
        throw notAllowed('The operation either timed out or was not allowed.');
      });
      await startSignUp(d);
      fireEvent.click(await approveButton());
      expect((await screen.findByTestId('signin-error', {}, { timeout: 3000 })).textContent).toBe(SIGN_UP_NOT_FINISHED);
      expect(pk.get).toHaveBeenCalledTimes(2);
      expect((screen.getByTestId('signup-approve') as HTMLButtonElement).disabled).toBe(false);
    });

    it('Cancel at Approve is quiet', async () => {
      const { pk, d } = signUpWith(async () => Promise.reject(notAllowed()));
      await startSignUp(d);
      await approveButton();
      fireEvent.click(screen.getByTestId('signup-cancel'));
      await waitFor(() => expect(screen.queryByTestId('signup-approve')).toBeNull());
      expect(screen.queryByTestId('signin-error')).toBeNull();
      expect(pk.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('an invitation link opened while signed out', () => {
    const invite = JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2', targetName: 'Beta' });

    it('shows the invitation as the page, not the landing hero', async () => {
      hold(invite);
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
      hold(invite);
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId('signin-passkey', {}, BOOT));
      fireEvent.click(await screen.findByTestId('invite-accept', {}, BOOT));
      await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('inv_abc'));
      await waitFor(() => expect(window.location.pathname).toBe('/app/org-1'), BOOT);
    });

    it('Not now shows the landing page and keeps the token', async () => {
      hold(invite);
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByTestId('invitation-not-now', {}, BOOT));
      fireEvent.click(await screen.findByText('Open sign-in'));
      expect((await screen.findByTestId('signin-desc')).textContent).toContain("You've been invited");
      expect(invites.token()).not.toBeNull();
    });
  });

  describe('one sign-in everywhere (@calimero-apps/passkey)', () => {
    const invite = JSON.stringify({ token: 'inv_abc', kind: 'namespace', targetId: 'org-2', workspaceId: 'org-2', targetName: 'Beta' });
    const forgetSessions = () => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('calimero-session:')) localStorage.removeItem(key);
    };

    it('a sign-in offers only the passkeys that worked on this cluster', async () => {
      const pk = { create: vi.fn(), get: vi.fn(async (..._args: unknown[]) => ({ credentialId: 'cred-here' }) as never) };
      const signInWith = (client: ReturnType<typeof fakeClient>) => {
        const signedIn = client.signIn.getMockImplementation()!;
        client.signIn.mockImplementation((async (p: PasskeyProvider) => {
          await p.get(new Uint8Array([1]), 'calimero.network');
          return signedIn();
        }) as never);
        return { ...deps(client), passkey: () => pk as unknown as PasskeyProvider };
      };
      const first = fakeClient();
      render(<App deps={signInWith(first)} />);
      fireEvent.click(await screen.findByText('Open sign-in'));
      fireEvent.click(await screen.findByTestId('signin-passkey'));
      await waitFor(() => expect(first.signIn).toHaveBeenCalled(), BOOT);
      expect(pk.get.mock.calls[0]?.[2]).toBeUndefined();
      cleanup();
      forgetSessions();

      const second = fakeClient();
      render(<App deps={signInWith(second)} />);
      fireEvent.click(await screen.findByText('Open sign-in', {}, BOOT));
      fireEvent.click(await screen.findByTestId('signin-passkey'));
      await waitFor(() => expect(pk.get).toHaveBeenCalledTimes(2), BOOT);
      expect(pk.get.mock.calls[1]?.[2]).toEqual(['cred-here']);
    });

    it('says which passkeys work here', async () => {
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByText('Open sign-in'));
      expect(await screen.findByText(SIGN_IN_HINT)).toBeTruthy();
    });

    it('an invited sign-in the cluster has no account for switches to creating one, in place', async () => {
      hold(invite);
      const client = fakeClient();
      client.signIn.mockRejectedValue(new CalimeroError(401, 'PASSKEY_UNKNOWN_HERE', 'unknown passkey'));
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId('signin-passkey', {}, BOOT));
      expect((await screen.findByTestId('signin-switched', {}, BOOT)).textContent).toBe(noAccountCopy('the workspace', true));
      expect(screen.getByTestId('signup-passkey').textContent).toBe('Create your account and join the workspace');
      expect(screen.queryByTestId('signin-error')).toBeNull();
    });

    it('an invited person who has signed in here before sees Sign in first', async () => {
      hold(invite);
      localStorage.setItem(accountHintKey(resolveTarget(DEV_ENV)), '1');
      render(<App deps={deps(fakeClient())} />);
      expect((await screen.findByTestId('signin-passkey', {}, BOOT)).textContent).toBe('Join the workspace with your passkey');
    });

    it('a sign-up carries the invite on an open cluster and joins in that step', async () => {
      hold(invite);
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId('signup-passkey', {}, BOOT));
      await waitFor(() => expect(client.signUp).toHaveBeenCalled(), BOOT);
      expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'inv_abc' });
      await waitFor(() => expect(invites.token()).toBeNull());
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });
  });
});

describe('the release the workspace runs (useInstanceRelease)', () => {
  /** A folder of the workspace, whose registry (`reg-1`) runs `version`. */
  function openWorkspace(version: string) {
    const client = Object.assign(fakeClient(), {
      getApp: vi.fn(async () => ({ appId: 'reg-1', org: 'org-1' })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: 'reg-1', package: { package: 'com.calimero.docs', version } }] })),
    });
    remember();
    window.history.replaceState(null, '', '/app/org-1/f/eng');
    render(<App deps={deps(client)} />);
    return client;
  }

  it('moves a served page to the frontend of the release the registry runs, and shows nothing of it meanwhile', async () => {
    release.href = `${HOST}/1.2.0/app/org-1/f/eng`;
    openWorkspace('1.0.0');
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/reg-1/app/org-1/f/eng`), BOOT);
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryAllByText('Launch plan')).toHaveLength(0), BOOT);
  });

  it('stays on a served page of the release the registry runs', async () => {
    release.href = `${HOST}/1.2.0/app/org-1/f/eng`;
    const client = openWorkspace('1.2.0');
    expect((await screen.findAllByText('Launch plan', {}, BOOT)).length).toBeGreaterThan(0);
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith('org-1'), BOOT);
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Launch plan').length).toBeGreaterThan(0);
  });

  it('does nothing in development', async () => {
    const client = openWorkspace('1.0.0');
    expect((await screen.findAllByText('Launch plan', {}, BOOT)).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
