// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppInfo, CalimeroClient, CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { APP, type SessionDeps } from './session';

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

function fakeClient(orgs: Array<{ orgId: string; name: string; role: string }> = [{ orgId: 'org-1', name: 'Team', role: 'owner' }]) {
  let session: CalimeroSession | undefined;
  let apps: AppInfo[] = orgs.length ? [BUDGET] : [];
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
    getOrg: vi.fn(async () => ({ name: 'Team', members: { [ME]: 'owner' }, memberMetadata: { [ME]: { name: 'Alice' } } })),
    listApps: vi.fn(async () => apps),
    createOrg: vi.fn(async (name: string) => {
      orgs = [{ orgId: 'org-new', name, role: 'owner' }];
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
    setMemberMetadata: vi.fn(async () => undefined),
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
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
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

  it('asks before redeeming an invitation, then opens the spreadsheet the link names', async () => {
    remember();
    localStorage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: 'tok-1', sheet: 'sheet-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith('sheet-1', 'listSheets', {}));
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it('takes an invitation link off the address bar before the first render', async () => {
    const { captureInvite, pendingInvite } = await import('./lib/workspaces');
    window.history.replaceState(null, '', '/?invite=tok-2&sheet=sheet-9');
    captureInvite();
    expect(pendingInvite()).toEqual({ token: 'tok-2', sheet: 'sheet-9' });
    expect(window.location.search).toBe('');
  });
});
