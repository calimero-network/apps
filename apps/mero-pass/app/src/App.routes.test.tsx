import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { isAuthenticated: false, isLoading: false };

// Only what the router and the pages reach for. Nothing here touches a node.
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    ...session,
    mero: null,
    nodeUrl: 'http://localhost:2528',
    logout: () => {},
  }),
  useNodeIdentity: () => ({ identity: null, loading: false }),
}));

// The landing page is 1100 lines of marketing template with its own animation
// and IntersectionObserver; this suite is about ROUTING, so stand it in.
vi.mock('./pages/landing/LandingPage', () => ({
  default: () => <div data-testid="landing" />,
}));

import App from './App';

/** Reports the path the router settled on, after every redirect has run. */
function Probe() {
  const { pathname } = useLocation();
  return <span data-testid="settled">{pathname}</span>;
}

function settleAt(path: string): string {
  const { unmount } = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Probe />
    </MemoryRouter>,
  );
  const settled = screen.getByTestId('settled').textContent ?? '';
  unmount();
  return settled;
}

describe('every path the app can be opened at settles', () => {
  beforeEach(() => {
    session.isAuthenticated = false;
    session.isLoading = false;
  });

  // ⚠️ THE REGRESSION TEST FOR THE REPORTED LOOP.
  //
  // `/landing` matched NO route. React Router rendered nothing, so the page was
  // a blank `#root` — verified against the deployed build, which answered a
  // 128-character root with zero links and zero buttons. With nothing to click,
  // the only move is to retry the connect flow, and `connectToNode` uses
  // `window.location.href` as its callback URL: each retry came back with
  // another `#node_url=…&access_token=…` CONCATENATED onto a URL that still
  // rendered nothing, which is the growing `&`-separated path the user saw.
  //
  // So the property under test is not "the redirect goes somewhere nice", it is
  // "no path renders nothing, and no path bounces forever".
  const PATHS = [
    '/',
    '/landing',
    '/docs',
    '/preview',
    '/login',
    '/teams',
    '/teams/ns-1',
    '/vault/ctx-1',
    '/home',
    '/space/ns-1',
    '/space',
    '/nope',
    '/a/b/c',
    '/~&~&~&',
    '/teams/ns-1/extra/depth',
  ];

  it.each(PATHS)('signed out, %s renders something', (path) => {
    const settled = settleAt(path);
    expect(settled).not.toBe('');
    // A settled path must be one the app actually serves. An unknown path that
    // stayed unknown is the blank page all over again.
    expect(
      ['/', '/landing', '/docs', '/preview', '/teams'].includes(settled) ||
        settled.startsWith('/teams/') ||
        settled.startsWith('/vault/'),
    ).toBe(true);
  });

  it.each(PATHS)('signed in, %s renders something', (path) => {
    session.isAuthenticated = true;
    const settled = settleAt(path);
    expect(settled).not.toBe('');
    // Signed in, nothing may settle on the marketing page: that is the loop
    // where login succeeds and returns you to where login started.
    expect(['/', '/landing'].includes(settled)).toBe(false);
  });

  it('a redirect is TERMINAL — its target is not itself a redirect', () => {
    // Each hop below must land on a path that renders a page. `/teams` has no
    // guard at all, which is what makes it a safe terminus for both the
    // catch-all and the signed-in guard.
    session.isAuthenticated = true;
    for (const path of ['/', '/landing', '/home', '/space/ns-1', '/nope']) {
      expect(settleAt(path)).toMatch(/^\/teams/);
    }
  });

  it('an unknown path signed out lands on the front door, not on itself', () => {
    expect(settleAt('/nope')).toBe('/');
    expect(settleAt('/~&~&~&')).toBe('/');
    expect(screen.queryByTestId('landing')).toBeNull(); // unmounted by settleAt
  });

  it('/landing is a real route rather than a fall-through', () => {
    // The specific path the user typed. Signed out it must render the landing
    // page AT `/landing` — not redirect, which would make the URL a lie — and
    // signed in it must go into the app.
    expect(settleAt('/landing')).toBe('/landing');
    session.isAuthenticated = true;
    expect(settleAt('/landing')).toBe('/teams');
  });

  it('renders nothing at all while the auth probe is in flight', () => {
    // Navigating before `isAuthenticated` is known sends a signed-in visitor to
    // the marketing page and then bounces them forward — two redirects and a
    // flash of the wrong page.
    session.isLoading = true;
    expect(settleAt('/nope')).toBe('/nope');
    expect(settleAt('/')).toBe('/');
  });

  it('a legacy /space link keeps its id on the way to /teams', () => {
    expect(settleAt('/space/ns-abc')).toBe('/teams/ns-abc');
  });
});
