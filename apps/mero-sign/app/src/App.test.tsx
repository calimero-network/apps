// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError } from '@calimero-network/mero-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { dropInvite, pendingInvite } from './lib/invites';

import { SessionStore, resolveTarget } from '@calimero-apps/connect';

import { APP, type SessionDeps } from './session';
import { DETAILS, DEV_ENV, ME, SESSION, deps, fakeClient, hold, remember } from './test/fixtures';

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock('@calimero-network/mero-react', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'create-dialog' },
            createElement('h2', { 'data-testid': 'create-title' }, p.labels?.title),
            createElement('p', { 'data-testid': 'create-self' }, p.defaultSelfName),
            createElement('pre', { 'data-testid': 'create-release' }, JSON.stringify(p.release)),
            createElement(
              'button',
              { 'data-testid': 'create-done', onClick: () => p.onCreated({ orgId: 'org-new', name: 'Fresh', selfName: 'Alice' }) },
              'done',
            ),
          )
        : null,
    InviteDialog: (p: { open: boolean; org: string; teams?: string[]; appName?: string; linkBase?: string; labels?: { noun?: string; title?: string; note?: string }; onClose: () => void }) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'invite-dialog' },
            createElement('h2', { 'data-testid': 'invite-title' }, p.labels?.title),
            createElement('p', { 'data-testid': 'invite-labels' }, JSON.stringify({ noun: p.labels?.noun, note: p.labels?.note })),
            createElement('pre', { 'data-testid': 'invite-props' }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName, linkBase: p.linkBase })),
            createElement('button', { 'data-testid': 'invite-close', onClick: p.onClose }, 'close'),
          )
        : null,
    AcceptInviteDialog: (p: { open: boolean; token: string; org?: string; appName?: string; labels?: { noun?: string; body?: string }; onClose: () => void; onError?: (e: unknown) => void; onJoined: (j: { org: string }) => void }) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'accept-dialog' },
            createElement('pre', { 'data-testid': 'accept-props' }, JSON.stringify({ token: p.token, org: p.org, appName: p.appName, noun: p.labels?.noun, body: p.labels?.body })),
            createElement('button', { 'data-testid': 'accept-done', onClick: () => p.onJoined({ org: 'org-1' }) }, 'join'),
            createElement('button', { 'data-testid': 'accept-close', onClick: p.onClose }, 'close'),
            createElement('button', { 'data-testid': 'accept-spent', onClick: () => p.onError?.(new CalimeroError(400, 'REJECTED', 'unknown invite')) }, 'spent'),
            createElement('button', { 'data-testid': 'accept-offline', onClick: () => p.onError?.(new CalimeroError(503, 'UNAVAILABLE', 'node unreachable')) }, 'offline'),
          )
        : null,
  };
});

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
  dropInvite();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

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

  it('opens the shared dialog for a new workspace, then names you in it and opens it', async () => {
    remember();
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('create-workspace'));
    expect((await screen.findByTestId('create-title')).textContent).toBe('New workspace');
    expect(JSON.parse(screen.getByTestId('create-release').textContent ?? 'null')).toEqual({ package: 'com.calimero.mero-sign' });
    fireEvent.click(screen.getByTestId('create-done'));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/org-new'));
    expect(client.setMemberMetadata).toHaveBeenCalledWith('org-new', ME, { name: 'Alice' });
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  describe('inviting to a workspace', () => {
    const PACKAGE_ENV = { DEV: true, VITE_CALIMERO_PACKAGE: 'com.calimero.mero-sign' };

    async function openInvite(client: ReturnType<typeof fakeClient>, env: SessionDeps['env']) {
      new SessionStore(APP, resolveTarget(env), localStorage).save(SESSION);
      window.history.replaceState(null, '', '/workspaces');
      render(<App deps={{ ...deps(client), env }} />);
      fireEvent.click(await screen.findByLabelText('More options'));
      fireEvent.click(screen.getByTestId('invite-to-workspace'));
    }
    const props = async () => JSON.parse((await screen.findByTestId('invite-props')).textContent ?? 'null');

    it('opens the shared dialog for the workspace, with the app team of a package app', async () => {
      const client = fakeClient();
      await openInvite(client, PACKAGE_ENV);
      expect(await props()).toEqual({ org: 'org-1', teams: ['team-sign'], appName: 'Hyperfeed Sign', linkBase: `${window.location.origin}/?org=org-1` });
      expect(screen.getByTestId('invite-title').textContent).toBe('Invite to Acme Legal');
      expect(JSON.parse(screen.getByTestId('invite-labels').textContent ?? 'null')).toEqual({ noun: 'workspace' });
      fireEvent.click(screen.getByTestId('invite-close'));
      await waitFor(() => expect(screen.queryByTestId('invite-dialog')).toBeNull());
    });

    it('adds the app-only note when the workspace keeps its apps apart', async () => {
      const client = fakeClient();
      client.listAppTeams.mockResolvedValue({ mode: 'shared', appTeams: [{ package: 'com.calimero.mero-sign', teamId: 'team-sign', name: 'Hyperfeed Sign', join: 'everyone', memberCount: 2, defaultCapabilities: 0, member: true }] });
      await openInvite(client, PACKAGE_ENV);
      const labels = JSON.parse((await screen.findByTestId('invite-labels')).textContent ?? 'null');
      expect(labels.note).toMatch(/^Invites to Hyperfeed Sign only/);
    });

    it('names no team for a raw bundle', async () => {
      const client = fakeClient();
      await openInvite(client, DEV_ENV);
      expect((await props()).teams).toEqual([]);
      expect(client.listAppTeams).not.toHaveBeenCalled();
    });

    it('says so, and opens nothing, when the workspace has no team for the app', async () => {
      const client = fakeClient();
      client.listAppTeams.mockResolvedValue({ mode: 'standalone', appTeams: [{ package: 'com.calimero.other', teamId: 'team-o', name: 'O', join: 'everyone', memberCount: 1, defaultCapabilities: 0, member: true }] });
      await openInvite(client, PACKAGE_ENV);
      expect((await screen.findByTestId('list-error')).textContent).toMatch(/has not set up com.calimero.mero-sign/);
      expect(screen.queryByTestId('invite-dialog')).toBeNull();
    });
  });

  it('tells a member who may not add an agreement to ask an owner, instead of offering Create (B8)', async () => {
    remember();
    window.history.replaceState(null, '', '/workspaces/org-1');
    const client = fakeClient();
    // A member whose workspace defaults were never set (the step-up refused): no CREATE_APP.
    client.getOrg.mockResolvedValue({ name: 'Acme Legal', members: { [ME]: 'member', 'acct-bob': 'owner' } });
    render(<App deps={deps(client)} />);
    expect((await screen.findByTestId('create-agreement-ask')).textContent).toMatch(/Only an owner or admin/);
    expect(screen.queryByTestId('create-agreement')).toBeNull();
  });

  it('places the node shield in the top bar, with no floating one beside it', async () => {
    remember();
    window.history.replaceState(null, '', '/workspaces/org-1');
    render(<App deps={deps(fakeClient())} />);
    await screen.findByText('Series A');
    expect(screen.getAllByTestId('node-shield')).toHaveLength(1);
    expect(screen.getByTestId('node-shield').closest('header')).not.toBeNull();
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
      expect(client.createApp).toHaveBeenCalledWith('NDA', 'bundle-hash', { org: 'org-1' }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('new-1', 'setup', {
        isPrivate: false,
        contextName: 'NDA',
      }));
    // Recorded in the private library the account already has.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('lib-1', 'joinSharedContext', {
        contextIdStr: 'new-1',
        sharedIdentityStr: ME,
        contextName: 'NDA',
      }));
  });

  it('opens an agreement and shows its documents in the screens’ shapes', async () => {
    remember();
    window.history.replaceState(null, '', '/agreements/agr-1');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await waitFor(() =>
      expect(screen.getByTestId('agreement-title').textContent).toBe('Series A'));
    await screen.findByText('Term sheet.pdf');
    expect(client.view).toHaveBeenCalledWith('agr-1', 'getContextDetails', {
      contextIdStr: 'agr-1',
    });
  });

  it('signed out with a pending invite, shows the invitation page instead of the landing page', async () => {
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    render(<App deps={deps(fakeClient())} />);
    const page = await screen.findByTestId('invitation-page');
    expect(page.textContent).toContain("You're invited");
    expect(page.textContent).toContain("You've been invited to join the workspace");
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('signing in on the invitation page goes straight to the join prompt, then into the workspace', async () => {
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByTestId('invitation-page');
    fireEvent.click(screen.getByTestId('signin-passkey'));
    fireEvent.click(await screen.findByTestId('accept-done'));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/org-1'));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invitation-page')).toBeNull();
  });

  it('an invited newcomer creates the account and joins in one click, and lands in the agreement', async () => {
    hold(JSON.stringify({ token: 'tok-1', agreement: 'agr-1', org: 'org-1' }));
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
    const create = await screen.findByTestId('signup-passkey');
    expect(create.textContent).toBe('Create your account and join the workspace');
    fireEvent.click(create);
    await waitFor(() =>
      expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-1' }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('agr-1', 'registerSelfAsParticipant', {}));
    await screen.findByTestId('agreement-title');
    expect(window.location.pathname).toBe('/agreements/agr-1');
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invitation-dialog')).toBeNull();
    expect(pendingInvite()).toBeNull();
  });

  it('"Not now" on the invitation page shows the landing page and keeps the token', async () => {
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId('invitation-not-now'));
    await screen.findByText('Connect');
    expect(pendingInvite()).not.toBeNull();
  });

  it('hands the dialog the invite\'s org, so a member is told so and nothing is redeemed', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: null, org: 'org-1' }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(JSON.parse((await screen.findByTestId('accept-props')).textContent ?? 'null').org).toBe('org-1');
    expect(screen.queryByTestId('invitation-member')).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('accept-done'));
    await waitFor(() => expect(pendingInvite()).toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/org-1'));
  });

  it('drops a stored token the node says is spent, and keeps it for a network failure', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId('accept-offline'));
    expect(pendingInvite()?.token).toBe('tok-1');
    fireEvent.click(screen.getByTestId('accept-spent'));
    expect(pendingInvite()).toBeNull();
  });

  it('hands the shared dialog the token, and drops it when the person closes the dialog', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    render(<App deps={deps(fakeClient())} />);
    expect(JSON.parse((await screen.findByTestId('accept-props')).textContent ?? 'null')).toMatchObject({ token: 'tok-1', appName: 'Hyperfeed Sign', noun: 'workspace' });
    fireEvent.click(screen.getByTestId('accept-close'));
    await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull());
    expect(pendingInvite()).toBeNull();
  });

  it('keeps the invite until the dialog says the person joined', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: null }));
    render(<App deps={deps(fakeClient())} />);
    await screen.findByTestId('accept-dialog');
    expect(pendingInvite()?.token).toBe('tok-1');
    fireEvent.click(screen.getByTestId('accept-done'));
    await waitFor(() => expect(pendingInvite()).toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/org-1'));
  });

  it('retries the last step without joining again when opening the agreement failed', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: 'agr-1' }));
    const client = fakeClient();
    const view = client.view.getMockImplementation()!;
    client.view.mockImplementation(async (app: string, method: string) =>
      method === 'listParticipants' ? { index: 1, result: [] } : view(app, method));
    client.call.mockRejectedValueOnce(new CalimeroError(500, 'INTERNAL', 'boom'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('accept-done'));
    expect((await screen.findByTestId('invitation-error')).textContent).toMatch(/could not be accepted/);
    expect(screen.queryByTestId('accept-dialog')).toBeNull();
    expect(pendingInvite()).toBeNull();
    fireEvent.click(screen.getByTestId('invitation-join'));
    await waitFor(() => expect(window.location.pathname).toBe('/agreements/agr-1'));
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it('asks before joining, then enters the agreement the link names', async () => {
    remember();
    hold(JSON.stringify({ token: 'tok-1', agreement: 'agr-1' }));
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
    fireEvent.click(await screen.findByTestId('accept-done'));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('agr-1', 'registerSelfAsParticipant', {}));
    await screen.findByTestId('agreement-title');
    expect(pendingInvite()).toBeNull();
  });
});
