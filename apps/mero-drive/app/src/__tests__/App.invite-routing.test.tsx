// An invite deep link has to survive the router.
//
// links.calimero.network forwards the invite query to the frontend ROOT, so
// every invite arrives on `/` with `?invitation=…` — including for people who
// are already signed in, who are most of the people who get one. `/` also
// carries the "you're signed in, go to the app" redirect, and `<Navigate
// to="/app">` drops the query string. The two fire in the same commit, and the
// deeper one wins, so the invitation was thrown away for exactly those users.
//
// These tests drive the real App router.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
// vitest hoists `vi.mock` above every import, so App can be imported here and
// still see the mocks below.
import App from '../App';

const meroState = { isAuthenticated: false, isLoading: false };

vi.mock('@calimero-network/mero-react', () => ({
  AppMode: { MultiContext: 'MultiContext' },
  MeroProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMero: () => meroState,
}));
vi.mock('@calimero-network/mero-ui', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
vi.mock('../pages/join', () => ({
  default: () => {
    const search = window.location.search;
    return <div data-testid="join" data-search={search} />;
  },
}));

function go(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  meroState.isAuthenticated = false;
  meroState.isLoading = false;
  go('/');
});

const INVITE = '?invitation=eyJ0ZXN0Ijp0cnVlfQ&kind=namespace&id=ns-1&name=Q3';

describe('invite deep links reach /join', () => {
  it('routes a signed-OUT visitor from / to /join', async () => {
    go(`/${INVITE}`);
    render(<App />);
    expect(await screen.findByTestId('join')).toBeTruthy();
    expect(window.location.pathname).toBe('/join');
  });

  // The regression: the signed-in redirect used to win this race and land on
  // /app with no query, so the invitation was gone.
  it('routes a signed-IN visitor from / to /join, not /app', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    render(<App />);
    expect(await screen.findByTestId('join')).toBeTruthy();
    expect(window.location.pathname).toBe('/join');
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('keeps every invite param across the hop', async () => {
    meroState.isAuthenticated = true;
    go(`/${INVITE}`);
    render(<App />);
    expect(await screen.findByTestId('join')).toBeTruthy();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('invitation')).toBe('eyJ0ZXN0Ijp0cnVlfQ');
    expect(params.get('kind')).toBe('namespace');
    expect(params.get('id')).toBe('ns-1');
    expect(params.get('name')).toBe('Q3');
  });

  it('accepts the legacy invite= param name', async () => {
    go('/?invite=eyJ0ZXN0Ijp0cnVlfQ&kind=namespace&id=ns-1');
    render(<App />);
    expect(await screen.findByTestId('join')).toBeTruthy();
    expect(window.location.pathname).toBe('/join');
  });

  // A link that landed on an unknown path must not have its query discarded by
  // the catch-all before InviteRedirect can act on it.
  it('survives an unknown path', async () => {
    meroState.isAuthenticated = true;
    go(`/nope${INVITE}`);
    render(<App />);
    expect(await screen.findByTestId('join')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('id')).toBe('ns-1');
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
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});
