// An invitation reaches this app only by its link being opened, and it has to
// reach the prompt whatever page that leaves the person on.
//
// links.calimero.network forwards the invite query to the frontend ROOT, so a
// cold open arrives on `/` with `?invitation=…` - including for people who are
// already signed in, who are most of the people who get one, and whom `/`
// redirects to `/app` with no query. A desktop that is already running hands
// the link over as a `deep-link` event instead, with the app open on /app.
// The shared capture takes both at boot; the prompt sits above the routes.
//
// These tests drive the real App router, the real capture and the real
// prompt (mero-react's InvitationDialog); only the node is fake.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from '@calimero-apps/cloud';
// vitest hoists `vi.mock` above every import, so App can be imported here and
// still see the mocks below.
import App from '../App';
import { saveReturnTo } from '@/lib/routes';

const joinNamespace = vi.hoisted(() => vi.fn(async () => ({})));
const meroState = {
  isAuthenticated: false,
  isLoading: false,
  admin: { joinNamespace, listNamespaces: async () => [] },
};

vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AppMode: { MultiContext: 'MultiContext' },
  MeroProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useMero: () => meroState,
}));
vi.mock('sonner', () => ({
  Toaster: () => null,
}));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn(), toggle: vi.fn() }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  DriveWorkspaceProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  markNamespaceJustJoined: vi.fn(),
}));
vi.mock('@/hooks/useApplicationId', () => ({
  useApplicationId: () => ({ appId: 'app-1' }),
}));
vi.mock('@/hooks/useAppNamespaces', () => ({
  useAppNamespaces: () => ({ namespaces: [] }),
}));
vi.mock('../pages/landing/LandingPage', () => ({
  default: () => <div data-testid="landing" />,
}));
vi.mock('../pages/workspace', () => ({
  default: () => <div data-testid="workspace" />,
}));
const SLUG = 'com.calimero.mero-drive-docs';

/** What a running desktop launcher injects before the app boots. */
function installBridge(): (raw: string) => void {
  const handlers = new Set<(payload: unknown) => void>();
  (window as unknown as Record<string, unknown>).__calimero_platform__ = {
    version: 1,
    capabilities: ['deepLink'],
    invoke: async () => null,
    on(event: string, handler: (payload: unknown) => void) {
      if (event === 'deep-link') handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return (raw) => handlers.forEach((h) => h({ raw }));
}

/** Boot as index.tsx does: capture first, then the app. */
function boot() {
  primeInvitationCapture('mero-docs', { slug: SLUG });
  return render(<App />);
}

function go(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  meroState.isAuthenticated = false;
  meroState.isLoading = false;
  sessionStorage.clear();
  localStorage.clear();
  joinNamespace.mockClear();
  resetInvitationCaptureForTests();
  delete (window as unknown as Record<string, unknown>).__calimero_platform__;
  go('/');
});

const INVITE = '?invitation=eyJ0ZXN0Ijp0cnVlfQ&kind=namespace&id=ns-1&name=Q3';

/** The prompt, once it is asking about the workspace named Q3. */
const asking = () => screen.findByRole('dialog', { name: 'Join “Q3”?' });
const prompt = () => screen.queryByTestId('invite-prompt');
const stage = () => prompt()?.getAttribute('data-stage');

describe('an opened invitation link reaches the prompt', () => {
  it('asks a signed-in visitor on /app, and joins only on accept', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    // The signed-in redirect still runs; the invitation survives it.
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(window.location.pathname).toBe('/app');
    await asking();
    expect(joinNamespace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('invite-accept'));
    // Joined; the workspace's data is still to come, so the prompt says so
    // rather than closing on an empty workspace.
    await waitFor(() => expect(stage()).toBe('syncing'));
    expect(joinNamespace).toHaveBeenCalledWith(
      'ns-1',
      expect.objectContaining({ groupName: 'Q3' }),
    );
    expect(window.location.pathname).toBe('/app');
    // Acked: it does not come back on the next load.
    expect(peekInvitation()).toBeNull();
  });

  it('takes the token out of the address bar', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    await asking();
    expect(window.location.search).not.toContain('invitation');
  });

  it('waits for a signed-out visitor to sign in, keeping the invitation', async () => {
    go(`/${INVITE}`);
    boot();
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(prompt()).toBeNull();
    expect(peekInvitation()?.params.id).toBe('ns-1');
  });

  it('declining drops it for good', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    await asking();
    fireEvent.click(screen.getByTestId('invite-decline'));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(peekInvitation()).toBeNull();
    expect(joinNamespace).not.toHaveBeenCalled();
  });

  it('a link that landed on an old /join URL is still offered', async () => {
    meroState.isAuthenticated = true;
    go(`/join${INVITE}`);
    boot();
    await asking();
    expect(peekInvitation()?.params.id).toBe('ns-1');
  });

  it('reads the id from the signed invitation when the link has none', async () => {
    meroState.isAuthenticated = true;
    // {"invitation":{"group_id":[171,1]}}
    go('/?invitation=eyJpbnZpdGF0aW9uIjp7Imdyb3VwX2lkIjpbMTcxLDFdfX0');
    boot();
    fireEvent.click(await screen.findByTestId('invite-accept'));
    await waitFor(() =>
      expect(joinNamespace).toHaveBeenCalledWith('ab01', expect.anything()),
    );
  });
});

describe('a link handed to the open desktop app', () => {
  it('shows the prompt on /app without a reload, and ignores another app’s link', async () => {
    meroState.isAuthenticated = true;
    const fire = installBridge();
    go('/app');
    boot();
    expect(await screen.findByTestId('workspace')).toBeTruthy();

    act(() => fire(`calimero://com.calimero.not-this-app/join${INVITE}`));
    expect(prompt()).toBeNull();

    act(() => fire(`calimero://${SLUG}/join${INVITE}`));
    await asking();
    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(stage()).toBe('syncing'));
    expect(joinNamespace).toHaveBeenCalledWith('ns-1', expect.anything());
    expect(window.location.pathname).toBe('/app');
  });
});

describe('ordinary routing is unchanged', () => {
  it('a signed-in visitor to / still goes to the app', async () => {
    meroState.isAuthenticated = true;
    go('/');
    render(<App />);
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(window.location.pathname).toBe('/app');
  });

  it('a signed-out visitor to / still sees the landing page', async () => {
    go('/');
    render(<App />);
    expect(screen.getByTestId('landing')).toBeTruthy();
  });

  it('an unknown path with no invite still redirects home', async () => {
    go('/nope');
    boot();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});

// Sign-in returns to `/` (the SSO callback is the page login started on), so
// the page a signed-out visitor was headed to is carried in sessionStorage.
describe('a signed-out deep link survives sign-in', () => {
  it('sends the signed-in visitor to the saved page with its query and hash', async () => {
    saveReturnTo('/app/w/f/f1/d/doc-2?node=2#b=blk');
    meroState.isAuthenticated = true;
    go('/');
    render(<App />);
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(window.location.pathname).toBe('/app/w/f/f1/d/doc-2');
    expect(window.location.search).toBe('?node=2');
    expect(window.location.hash).toBe('#b=blk');
  });

  it('ignores a saved target outside the app', async () => {
    sessionStorage.setItem('mero-drive:returnTo', 'https://evil.example/app/w');
    meroState.isAuthenticated = true;
    go('/');
    render(<App />);
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(window.location.pathname).toBe('/app');
  });
});
