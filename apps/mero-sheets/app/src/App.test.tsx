// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { APP, type SessionDeps } from './session';
import { invites, migrateLegacyInvite } from './lib/workspaces';

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
function hold(legacy: string) {
  localStorage.setItem(`${APP}:pending-invite`, legacy);
  migrateLegacyInvite();
}

// The landing page is generated and tested on its own; here it is the door.
vi.mock('./pages/landing/LandingPage', () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect
    </button>
  ),
}));

// The recalc engine is a wasm module; the screens fall back to the node's
// computed values until it is ready, so it never needs to be.
vi.mock('./engine/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine/engine')>()),
  initEngine: () => new Promise<void>(() => {}),
}));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  Element.prototype.scrollTo = vi.fn() as never;
  Element.prototype.scrollIntoView = vi.fn() as never;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).IntersectionObserver = Observer;
  (globalThis as Record<string, unknown>).ResizeObserver = Observer;
});

beforeEach(() => {
  localStorage.clear();
  invites.drop();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

const ME = 'acct-alice';
const SESSION: CalimeroSession = { accountId: ME, sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const BUDGET: AppInfo = {
  appId: 'sheet-1',
  name: 'Q3 Budget',
  owner: ME,
  org: 'org-1',
  bundle: 'bundle-hash',
  package: null,
  version: null,
};

/** What the workbook's views answer: v1's shapes, 64-bit integers as strings. */
const VIEWS: Record<string, unknown> = {
  whoami: ME,
  getProject: { id: 'proj-1', name: 'Q3 Budget', created_at: '1700000000000000000' },
  listSheets: [{ id: 'sheet-a', name: 'Sheet 1', position: 0, created_at: '1700000000000000000', linked_from: '' }],
  getMembers: [{ id: ME, nickname: 'Alice', joined_at: '1', updated_at: '1', account: ME, role: 'owner' }],
};

function fakeClient(
  orgs: Array<{ orgId: string; name: string; role: string }> = [{ orgId: 'org-1', name: 'Team', role: 'owner' }],
  opts: { foreign?: AppInfo[]; sheets?: AppInfo[] } = {},
) {
  let session: CalimeroSession | undefined;
  let apps: AppInfo[] = opts.sheets ?? (orgs.length ? [BUDGET] : []);
  const foreign = opts.foreign ?? [];
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
    me: vi.fn(async () => ({ orgs })),
    getOrg: vi.fn(
      async (): Promise<Record<string, unknown>> => ({
        name: 'Team',
        members: { [ME]: 'owner' },
        memberMetadata: { [ME]: { name: 'Alice' } },
      }),
    ),
    listApps: vi.fn(async (filter?: { bundle?: string }) =>
      [...apps, ...foreign].filter((a) => !filter?.bundle || a.bundle === filter.bundle),
    ),
    createOrg: vi.fn(async (name: string) => {
      orgs = [...orgs, { orgId: 'org-new', name, role: 'owner' }];
      return 'org-new';
    }),
    setCapabilities: vi.fn(async () => undefined),
    createApp: vi.fn(async (name: string, _source: unknown, opts: { org?: string }) => {
      apps = [...apps, { ...BUDGET, appId: 'sheet-new', name, org: opts.org ?? null }];
      return 'sheet-new';
    }),
    call: vi.fn(async (_app: string, method: string) => ({ index: 1, result: method === 'createSheet' ? 'sheet-a' : null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: VIEWS[method] ?? [] })),
    events: vi.fn(async function* () {}),
    presenceStream: vi.fn(async function* () {}),
    publishPresence: vi.fn(async () => undefined),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    setMemberMetadata: vi.fn(async (_org: string, _account: string, _meta: unknown): Promise<void> => undefined),
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
  it('signs in with a passkey from the landing page and lists the workspace’s spreadsheets', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Connect'));
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    await screen.findByText('Q3 Budget');
    expect(client.signIn).toHaveBeenCalled();
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Team');
  });

  it('opens a spreadsheet: reads the workbook with camelCase views on its app instance', async () => {
    remember();
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Q3 Budget'));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'whoami', {}));
    await waitFor(() => expect(client.events).toHaveBeenCalledWith('sheet-1', 2, expect.anything()));
  });

  it('creates the workspace with the first spreadsheet, then names it in the contract', async () => {
    remember();
    const client = fakeClient([]);
    render(<App deps={deps(client)} />);
    const name = await screen.findByTestId('field-name');
    fireEvent.change(name, { target: { value: 'Forecast' } });
    await waitFor(() => expect((screen.getByTestId('action-init_project') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('action-init_project'));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Forecast', 'bundle-hash', { org: 'org-new' }));
    expect(client.createOrg).toHaveBeenCalled();
    expect(client.setCapabilities).toHaveBeenCalled();
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('sheet-new', 'initProject', { name: 'Forecast' }));
  });

  describe('an org made for another app', () => {
    // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
    const OVERWORLD = [{ orgId: 'ow', name: 'overworld', role: 'owner' }];
    const BLOCKS: AppInfo = {
      appId: 'blocks-1',
      name: 'overworld',
      owner: ME,
      org: 'ow',
      bundle: 'blocks-bundle',
      package: 'com.calimero.mero-blocks',
      version: null,
    };

    it('is not the workspace: none is shown and creating makes a new org', async () => {
      remember();
      const client = fakeClient(OVERWORLD, { foreign: [BLOCKS], sheets: [] });
      render(<App deps={deps(client)} />);
      const name = await screen.findByTestId('field-name');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mero Sheets');
      expect(screen.queryByTestId('connect-org-ow')).toBeNull();
      fireEvent.change(name, { target: { value: 'Forecast' } });
      await waitFor(() => expect((screen.getByTestId('action-init_project') as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByTestId('action-init_project'));
      await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Forecast', 'bundle-hash', { org: 'org-new' }));
      expect(client.createApp).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), { org: 'ow' });
    });

    it('is offered under "Connect to an existing organization", and a spreadsheet is created there on choice', async () => {
      remember();
      const client = fakeClient(OVERWORLD, { foreign: [BLOCKS], sheets: [] });
      client.getOrg.mockResolvedValue({ name: 'overworld', members: { [ME]: 'owner' }, memberMetadata: { [ME]: { name: 'Alice' } } });
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId('connect-existing-org'));
      const choice = await screen.findByTestId('connect-org-ow');
      expect(choice.textContent).toContain('Mero Blocks: overworld');
      fireEvent.click(choice);
      await waitFor(() =>
        expect(client.createApp).toHaveBeenCalledWith('Untitled Spreadsheet', 'bundle-hash', { org: 'ow' }),
      );
      expect(client.createOrg).not.toHaveBeenCalled();
    });

    it('leaves an org that holds spreadsheets listed and resumable', async () => {
      remember();
      const client = fakeClient([...OVERWORLD, { orgId: 'org-1', name: 'Team', role: 'owner' }], {
        foreign: [BLOCKS],
        sheets: [BUDGET],
      });
      render(<App deps={deps(client)} />);
      await screen.findByText('Q3 Budget');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Team');
    });
  });

  it('asks before redeeming an invitation, then opens the spreadsheet the link names', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', sheet: 'sheet-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    expect(invites.token()).toBeNull();
  });

  it('joining a workspace that has no name for you asks it once, saves it to the workspace, then opens the spreadsheet', async () => {
    remember();
    localStorage.setItem('calimero-names:last', 'Ali');
    hold(JSON.stringify({ token: 'tok-1', sheet: 'sheet-1' }));
    const client = fakeClient();
    // Not in the workspace until the invite is redeemed.
    let joined = false;
    client.me.mockImplementation(async () => ({ orgs: joined ? [{ orgId: 'org-1', name: 'Team', role: 'member' }] : [] }));
    client.redeemInvite.mockImplementation(async () => {
      joined = true;
      return { org: 'org-1' };
    });
    const meta: Record<string, unknown> = {};
    client.getOrg.mockImplementation(async () => ({ name: 'Team', members: { [ME]: 'member' }, memberMetadata: { ...meta } }));
    client.setMemberMetadata.mockImplementation(async (_org: string, account: string, m: unknown) => {
      meta[account] = m;
    });
    client.view.mockImplementation(async (_app: string, method: string) => ({
      index: 1,
      result: method === 'getMembers' ? [] : (VIEWS[method] ?? []),
    }));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    const field = (await screen.findByTestId('field-nickname')) as HTMLInputElement;
    expect(field.value).toBe('Ali');
    expect(client.view).not.toHaveBeenCalledWith('sheet-1', 'listSheets', {});
    fireEvent.click(screen.getByTestId('action-join'));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', ME, { name: 'Ali' }));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    // The spreadsheet takes the workspace's name into its roster without asking.
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('sheet-1', 'join', { nickname: 'Ali' }));
    expect(screen.queryByTestId('nickname-modal')).toBeNull();
  });

  it('opening a spreadsheet in a workspace that has your name never asks, and fills the roster silently', async () => {
    remember();
    const client = fakeClient();
    client.view.mockImplementation(async (_app: string, method: string) => ({
      index: 1,
      result: method === 'getMembers' ? [] : (VIEWS[method] ?? []),
    }));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Q3 Budget'));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('sheet-1', 'join', { nickname: 'Alice' }));
    expect(screen.queryByTestId('nickname-modal')).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it('signed out with a pending invite, shows the invitation page instead of the landing page', async () => {
    hold(JSON.stringify({ token: 'tok-1', sheet: null }));
    render(<App deps={deps(fakeClient())} />);
    const page = await screen.findByTestId('invitation-page');
    expect(page.textContent).toContain("You're invited");
    expect(page.textContent).toContain("You've been invited to join the workspace");
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('signing in on the invitation page goes straight to the join prompt, then into the workspace', async () => {
    hold(JSON.stringify({ token: 'tok-1', sheet: 'sheet-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByTestId('invitation-page');
    fireEvent.click(screen.getByTestId('signin-passkey'));
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    expect(screen.queryByTestId('invitation-page')).toBeNull();
  });

  it('an invited newcomer creates the account and joins in one click, and lands in the spreadsheet', async () => {
    hold(JSON.stringify({ token: 'tok-1', sheet: 'sheet-1', org: 'org-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    const create = await screen.findByTestId('signup-passkey');
    expect(create.textContent).toBe('Create your account and join the workspace');
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-1' }));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invitation-dialog')).toBeNull();
    expect(screen.queryByTestId('invitation-page')).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it('"Not now" on the invitation page shows the landing page and keeps the token', async () => {
    hold(JSON.stringify({ token: 'tok-1', sheet: null }));
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId('invitation-not-now'));
    await screen.findByText('Connect');
    expect(screen.queryByTestId('invitation-page')).toBeNull();
    expect(invites.token()).not.toBeNull();
  });

  it('does not redeem an invite into a workspace the account is already in', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', sheet: null, org: 'org-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByTestId('invitation-member');
    expect(screen.getByRole('heading', { name: /already in this workspace/ })).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', sheet: null }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    const error = await screen.findByTestId('invitation-error');
    expect(error.textContent).toBe('This invite was already used or has expired. Ask the person who invited you for a new link.');
    expect(invites.token()).toBeNull();
  });

  it('takes an invitation link off the address bar before the first render', async () => {
    const { captureInvite, pendingInvite } = await import('./lib/workspaces');
    window.history.replaceState(null, '', '/?invite=tok-2&sheet=sheet-9');
    captureInvite();
    expect(pendingInvite()).toEqual({ token: 'tok-2', sheet: 'sheet-9', org: null });
    expect(window.location.search).toBe('');
  });

  it.each([
    [429, 'RATE_LIMITED', /Too many tries/],
    [401, 'UNAUTHENTICATED', /sign in again/],
  ])('keeps the invite when redeeming answers %i, and says to try again (B6)', async (status, code, says) => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', sheet: null }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, 'not now'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    expect((await screen.findByTestId('invitation-error')).textContent).toMatch(says);
    expect(invites.token()).toBe('tok-1');
    expect(screen.getByTestId('invitation-join')).toBeTruthy();
  });
});
