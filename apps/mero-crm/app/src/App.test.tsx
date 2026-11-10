import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type CalimeroClient, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import App from './App';
import type { SessionDeps } from './session';
import { APP } from './session';
import { readActiveNs, writeActiveNs } from './hooks/workspacePersistence';
import { invites } from './workspaces';

/** Hold `token` as the pending invite, as a captured link would. */
function holdInvite(token: string, target: { org?: string; route?: string } = {}) {
  invites.put({ token, org: target.org ?? null, team: null, doc: null, route: target.route ?? null, extra: {} });
}

const SESSION: CalimeroSession = { accountId: 'acct-alice', sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const STAGES = [
  { id: 'stage-lead', name: 'Lead in', probability: 10, position: 0 },
  { id: 'stage-qualified', name: 'Qualified', probability: 25, position: 1 },
];

/** A deal as the contract answers it: v1's snake_case fields, u64s as decimal strings. */
const DEAL = {
  id: 'deal-1700000000000-aabbccdd',
  title: 'Acme 50 seats',
  value: '24000',
  organization: 'Acme',
  contact_id: null,
  contact_name: null,
  owner: 'acct-alice',
  stage_id: 'stage-lead',
  status: 'open',
  lost_reason: '',
  expected_close: null,
  source: 'Referral',
  probability: 10,
  stage_entered_at: String(Date.now()),
  closed_at: null,
  next_activity: null,
  open_activities: 0,
  last_touch_at: null,
  created_by: 'acct-alice',
  created_at: String(Date.now()),
};

function fakeClient(opts: { signedIn?: boolean } = {}) {
  let session: CalimeroSession | undefined = opts.signedIn ? SESSION : undefined;
  const views: Record<string, unknown> = {
    listStages: STAGES,
    listDeals: [DEAL],
    listContacts: [],
    listActivities: [],
    listAutomations: [],
    getSettings: { currency: 'USD', rotting_days: 14 },
  };
  const client = {
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
    me: vi.fn(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-1', name: 'Platform', role: 'owner' }] })),
    getOrg: vi.fn(async () => ({
      members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
      memberMetadata: { 'acct-alice': { name: 'Alice' }, 'acct-bob': { name: 'Bob' } },
      capabilities: {},
      defaultCapabilities: 3,
    })),
    listApps: vi.fn(async () => [
      { appId: 'app-1', name: 'New business', owner: 'acct-alice', org: 'org-1', bundle: 'bundle-hash', package: null, version: null },
      { appId: 'app-x', name: 'elsewhere', owner: 'acct-alice', org: 'org-2', bundle: 'bundle-hash', package: null, version: null },
    ]),
    createOrg: vi.fn(async () => 'org-new'),
    setOrgMetadata: vi.fn(async () => {}),
    setCapabilities: vi.fn(async () => {}),
    createApp: vi.fn(async () => 'app-new'),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: views[method] ?? null })),
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => 'tok-123'),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    setMemberMetadata: vi.fn(async () => {}),
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(cleanup);

// Each screen here waits on a chain of mocked requests (session -> /me ->
// listApps -> views); under a parallel workspace run that takes longer than
// testing-library's 1 s default.
const SLOW = { timeout: 10_000 };

function storeSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

describe('App', () => {
  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it('does not list or enter an org made for another app; connects it on request', async () => {
    const client = fakeClient({ signedIn: true });
    const blocks = { appId: 'w1', name: 'overworld', owner: 'acct-alice', org: 'ow', bundle: 'blocks', package: 'com.calimero.mero-blocks', version: null };
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'ow', name: 'overworld', role: 'owner' }] }));
    client.listApps.mockImplementation((async (f?: { bundle?: string }) => (f?.bundle ? [] : [blocks])) as never);
    storeSession();
    writeActiveNs('ow');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('ns-empty-state', {}, SLOW)).toBeTruthy();
    expect(screen.queryByTestId('connect-org-ow')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-existing-org'));
    const choice = await screen.findByTestId('connect-org-ow', {}, SLOW);
    expect(choice.textContent).toContain('Mero Blocks: overworld');
    fireEvent.click(choice);
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Pipeline', 'bundle-hash', { org: 'ow' }), SLOW);
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('signs in with a passkey from the landing page', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    // The landing re-renders once the session settles (the sign-up policy read
    // lands after `signed-out`), and its CTA is a component made in render, so
    // a button found before that is detached and a click on it does nothing.
    // Click the current one until the sign-in popup is open.
    await waitFor(() => {
      if (!screen.queryByTestId('signin-passkey')) {
        fireEvent.click(screen.getAllByRole('button', { name: /sign in|connect|get started|open/i })[0]!);
      }
      expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    }, SLOW);
    fireEvent.click(screen.getByTestId('signin-passkey'));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
  });

  it('opens the remembered workspace on its first pipeline and shows its deals', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    // Only this workspace's pipelines, and the board read from the open one.
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
    expect(screen.queryByText('elsewhere')).toBeNull();
    expect(client.view).toHaveBeenCalledWith('app-1', 'listDeals', { status: null, stageId: null, owner: null });
  });

  it('asks before redeeming an invitation, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    expect(invites.token()).toBeNull();
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
  });

  it('labels the landing page action "Sign in" and offers no desktop app on a web-only app', async () => {
    render(<App deps={deps(fakeClient())} />);
    expect((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /connect to node/i })).toBeNull();
    expect(screen.queryByText(/get the desktop app/i)).toBeNull();
    expect(document.querySelector('a[href="https://calimero.network/download"]')).toBeNull();
  });

  it('shows an invitation page, not the landing page, to a signed-out visitor with an invite', async () => {
    holdInvite('tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    expect(await screen.findByTestId('invitation-page', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the workspace in Mero CRM/)).toBeTruthy();
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    // A page, not a popup over the landing hero.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.cal-lp-root')).toBeNull();
  });

  it('an invited newcomer creates the account and joins in one click, and lands in the workspace', async () => {
    const client = fakeClient();
    holdInvite('tok-xyz');
    render(<App deps={deps(client)} />);

    const create = await screen.findByTestId('signup-passkey', {}, SLOW);
    expect(create.textContent).toBe('Create your account and join the workspace');
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(screen.queryByTestId('invitation-page')).toBeNull(), SLOW);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invitation-dialog')).toBeNull();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    holdInvite('tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(document.querySelector('.cal-lp-root')).not.toBeNull(), SLOW);
    expect(invites.token()).toBe('tok-xyz');
  });

  it('asks to join right after signing in from the invitation page, then opens the linked route', async () => {
    const client = fakeClient();
    holdInvite('tok-xyz', { route: '/crm/members' });
    window.history.replaceState(null, '', '/crm/members');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt.
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    expect(invites.token()).toBeNull();
  });

  it('tells a member of the invited workspace they are already in it, without spending the invite', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz', { org: 'org-1' });
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText("You're already in this workspace", {}, SLOW)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId('invitation-continue'));
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    expect(
      await screen.findByText(
        'This invite was already used or has expired. Ask the person who invited you for a new link.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it('lands on the deep-linked route after joining, even from the landing page the sign-in redirect left', async () => {
    // The front door's own redirect (signed in at `/` -> /crm) must not win
    // against the move to the invite's route.
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-2');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now": the guard on /crm/members sends a signed-out visitor to `/`.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    // Sign in from the landing page: the join prompt follows with no extra click.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW))[0]);
    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    // And it stays there: no late redirect to the CRM's start.
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
  });

  it('lands on the deep-linked route after signing in on the invitation page and joining', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-2');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
    expect(window.location.search).toBe('');
  });

  it('an invited newcomer who signs up from the landing page lands on the page the link named (B10)', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-1');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now", then create the account from the landing page: the sign-up joins.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW))[0]);
    fireEvent.click(await screen.findByTestId('signup-passkey', {}, SLOW));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
  });

  it.each([
    [429, 'RATE_LIMITED', /Too many tries/],
    [401, 'UNAUTHENTICATED', /sign in again/],
  ])('keeps the invite when redeeming answers %i, and says to try again (B6)', async (status, code, says) => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, 'not now'));
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    expect(await screen.findByText(says, {}, SLOW)).toBeTruthy();
    expect(invites.token()).toBe('tok-xyz');
    expect(screen.getByTestId('invitation-join').textContent).toBe('Try again');
  });

  describe('your name, asked once per workspace', () => {
    /** An org that has no name for Alice yet, until `setMemberMetadata` writes one. */
    function unnamed(client: ReturnType<typeof fakeClient>) {
      let alice: Record<string, unknown> | undefined;
      const mocks = client as unknown as { getOrg: Mock; setMemberMetadata: Mock };
      mocks.getOrg.mockImplementation(async () => ({
        members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
        memberMetadata: { ...(alice ? { 'acct-alice': alice } : {}), 'acct-bob': { name: 'Bob' } },
        capabilities: {},
        defaultCapabilities: 3,
      }));
      mocks.setMemberMetadata.mockImplementation(async (_org: string, _account: string, meta: Record<string, unknown>) => {
        alice = meta;
      });
    }

    it('never asks on opening a workspace that already has your name', async () => {
      const client = fakeClient({ signedIn: true });
      storeSession();
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client)} />);

      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).not.toHaveBeenCalled();
    });

    it('asks for your name in the create dialog and writes it to the new workspace', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
      localStorage.setItem('calimero-names:last', 'Alice L');
      storeSession();
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client)} />);

      fireEvent.click(await screen.findByTestId('ns-create-btn', {}, SLOW));
      // Prefilled with the name used for the last workspace, and required.
      const self = screen.getByTestId('ns-create-self-name') as HTMLInputElement;
      expect(self.value).toBe('Alice L');
      fireEvent.change(screen.getByTestId('ns-create-name'), { target: { value: 'Platform' } });
      fireEvent.change(self, { target: { value: '' } });
      expect((screen.getByTestId('ns-create-submit') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(self, { target: { value: 'Alice' } });
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-new', name: 'Platform', role: 'owner' }] }));
      fireEvent.click(screen.getByTestId('ns-create-submit'));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-new', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(readActiveNs()).toBe('org-new'), SLOW);
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(localStorage.getItem('calimero-names:last')).toBe('Alice');
    });

    it('asks once right after joining a workspace that has no name for you', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      localStorage.setItem('calimero-names:last', 'Alice');
      storeSession();
      holdInvite('tok-xyz');
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client)} />);

      fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
      const input = (await screen.findByTestId('alias-gate-name', {}, SLOW)) as HTMLInputElement;
      expect(input.value).toBe('Alice');
      fireEvent.click(screen.getByTestId('alias-gate-save'));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      // Not asked again on opening the workspace.
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).toHaveBeenCalledTimes(1);
    });

    it('asks once on entering a workspace made before names were asked, then never again', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      storeSession();
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm');
      const { unmount } = render(<App deps={deps(client)} />);

      fireEvent.change(await screen.findByTestId('alias-gate-name', {}, SLOW), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByTestId('alias-gate-save'));
      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(screen.queryByTestId('alias-gate')).toBeNull(), SLOW);
      unmount();

      render(<App deps={deps(client)} />);
      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
    });
  });
});
