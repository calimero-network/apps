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
// These tests drive the real App router and the real capture.

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
} from '@calimero-apps/invite';
// vitest hoists `vi.mock` above every import, so App can be imported here and
// still see the mocks below.
import App from '../App';
import { saveReturnTo } from '@/lib/routes';

const meroState = { isAuthenticated: false, isLoading: false };

vi.mock('@calimero-network/mero-react', () => ({
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
}));
vi.mock('../pages/landing/LandingPage', () => ({
  default: () => <div data-testid="landing" />,
}));
vi.mock('../pages/workspace', () => ({
  default: () => <div data-testid="workspace" />,
}));
// The card's own behaviour (the join call, its failures) is pinned in its own
// tests; here it only has to show what it was handed and say yes.
const joinedVia = vi.fn();
vi.mock('@/components/workspace/JoinInviteCard', () => ({
  JoinInviteCard: ({
    parsed,
    onJoined,
    secondaryAction,
  }: {
    parsed: { kind: string; targetId: string; targetName?: string };
    onJoined: () => void;
    secondaryAction?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="card" data-target={parsed.targetId}>
      {parsed.targetName}
      <button
        data-testid="invite-accept"
        onClick={() => {
          joinedVia(parsed.targetId);
          onJoined();
        }}
      >
        Accept &amp; join
      </button>
      <button data-testid="invite-decline" onClick={secondaryAction?.onClick}>
        {secondaryAction?.label}
      </button>
    </div>
  ),
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
  joinedVia.mockClear();
  resetInvitationCaptureForTests();
  delete (window as unknown as Record<string, unknown>).__calimero_platform__;
  go('/');
});

const INVITE = '?invitation=eyJ0ZXN0Ijp0cnVlfQ&kind=namespace&id=ns-1&name=Q3';

describe('an opened invitation link reaches the prompt', () => {
  it('asks a signed-in visitor on /app, and joins only on accept', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    // The signed-in redirect still runs; the invitation survives it.
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(window.location.pathname).toBe('/app');
    const card = await screen.findByTestId('card');
    expect(card.dataset.target).toBe('ns-1');
    expect(card.textContent).toContain('Q3');
    expect(joinedVia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(joinedVia).toHaveBeenCalledWith('ns-1');
    await waitFor(() => expect(screen.queryByTestId('card')).toBeNull());
    expect(window.location.pathname).toBe('/app');
    // Acked: it does not come back on the next load.
    expect(peekInvitation()).toBeNull();
  });

  it('takes the token out of the address bar', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    await screen.findByTestId('card');
    expect(window.location.search).not.toContain('invitation');
  });

  it('waits for a signed-out visitor to sign in, keeping the invitation', async () => {
    go(`/${INVITE}`);
    boot();
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(screen.queryByTestId('card')).toBeNull();
    expect(peekInvitation()?.params.id).toBe('ns-1');
  });

  it('declining drops it for good', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    boot();
    await screen.findByTestId('card');
    fireEvent.click(screen.getByTestId('invite-decline'));
    await waitFor(() => expect(screen.queryByTestId('card')).toBeNull());
    expect(peekInvitation()).toBeNull();
    expect(joinedVia).not.toHaveBeenCalled();
  });

  it('a link that landed on an old /join URL is still offered', async () => {
    meroState.isAuthenticated = true;
    go(`/join${INVITE}`);
    boot();
    expect((await screen.findByTestId('card')).dataset.target).toBe('ns-1');
  });

  it('reads the id from the signed invitation when the link has none', async () => {
    meroState.isAuthenticated = true;
    // {"invitation":{"group_id":[171,1]}}
    go('/?invitation=eyJpbnZpdGF0aW9uIjp7Imdyb3VwX2lkIjpbMTcxLDFdfX0');
    boot();
    expect((await screen.findByTestId('card')).dataset.target).toBe('ab01');
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
    expect(screen.queryByTestId('card')).toBeNull();

    act(() => fire(`calimero://${SLUG}/join${INVITE}`));
    expect((await screen.findByTestId('card')).dataset.target).toBe('ns-1');
    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(joinedVia).toHaveBeenCalledWith('ns-1');
    await waitFor(() => expect(screen.queryByTestId('card')).toBeNull());
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
