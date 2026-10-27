import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = { isAuthenticated: false, isLoading: false };

// Only what the router and the pages reach for. Nothing here touches a node.
vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    ...session,
    mero: null,
    admin: null,
    isDelegated: false,
    applicationId: null,
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
import { destinationFor } from './lib/redeemFlow';

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
    // Each hop below must land on a path that renders a page. `/teams`'s own
    // guard lets a signed-in visitor through, which is what makes it a safe
    // terminus for both the catch-all and the signed-in guard.
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

  // ⚠️ THE REGRESSION TEST FOR BACK-AFTER-LOG-OUT. The in-app routes had no
  // sign-in guard, so Back after Log out rendered the app frame around no
  // data. Signed out, every in-app path goes to the front door.
  it.each(['/teams', '/teams/ns-1', '/vault/ctx-1', '/security'])(
    'signed out, in-app %s lands on the front door',
    (path) => {
      expect(settleAt(path)).toBe('/');
    },
  );

  it.each(['/teams', '/teams/ns-1', '/vault/ctx-1', '/security'])(
    'while the session is restored, %s stays put and renders nothing',
    (path) => {
      // Bouncing here would throw a signed-in deep link onto the landing page
      // before mero-react finished reading its stored session.
      session.isLoading = true;
      const { container, unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <App />
          <Probe />
        </MemoryRouter>,
      );
      expect(screen.getByTestId('settled').textContent).toBe(path);
      expect(
        container.querySelector('[data-testid="theme-toggle"]'),
      ).toBeNull();
      unmount();
    },
  );

  it.each(['/teams/ns-1', '/vault/ctx-1', '/security'])(
    'signed in, a deep link to %s stays there',
    (path) => {
      session.isAuthenticated = true;
      expect(settleAt(path)).toBe(path);
    },
  );

  it('/share and the reference pages stay public', () => {
    for (const path of ['/share', '/docs', '/preview']) {
      expect(settleAt(path)).toBe(path);
    }
  });

  // Resuming where you were (`lib/lastVisit`) happens only on the way IN: the
  // landing redirect marks its navigation, and a plain `/teams` — the rail,
  // the brand, a "Vaults" back link — carries no mark and stays the list.
  it('only the way into the app asks the teams screen to resume', () => {
    session.isAuthenticated = true;
    const stateAt = (path: string) => {
      let state: unknown = 'unset';
      function StateProbe() {
        state = useLocation().state;
        return null;
      }
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <App />
          <StateProbe />
        </MemoryRouter>,
      );
      unmount();
      return state;
    };
    expect(stateAt('/')).toEqual({ resume: true });
    expect(stateAt('/landing')).toEqual({ resume: true });
    expect(stateAt('/teams')).toBeNull();
  });

  it('a legacy /space link keeps its id on the way to /teams', () => {
    session.isAuthenticated = true;
    expect(settleAt('/space/ns-abc')).toBe('/teams/ns-abc');
  });
});

// ── Where a redeemed invitation lands ───────────────────────────────────────
//
// ⚠️ THE BUG THIS CATCHES. `InvitationPrompt` navigated to `/team/<id>` —
// SINGULAR. The route table declares `/teams/:teamId` and no `/team/:teamId`,
// so accepting a team invitation fell through to `*`, which redirects to
// `/teams`. It looked like it worked: you landed on a real page, just not the
// team you had joined, and nothing anywhere said why.
//
// Asserting the destination against the REAL router — rather than against a
// copy of the route list — is the only version of this test that cannot drift
// when a path is renamed.
describe('a redeemed invitation lands on a route that exists', () => {
  beforeEach(() => {
    session.isAuthenticated = true;
    session.isLoading = false;
  });

  it('a joined team lands IN the team, not back on the list', () => {
    const destination = destinationFor({ kind: 'team', namespaceId: 'ns-1' });
    expect(destination).toBe('/teams/ns-1');
    // The real assertion: the router does not move it.
    expect(settleAt(destination)).toBe(destination);
  });

  it('a joined vault lands in the vault', () => {
    const destination = destinationFor({
      kind: 'vault',
      contextId: 'ctx-1',
      identity: 'id-1',
    });
    expect(settleAt(destination)).toBe(destination);
  });

  it('an unplaceable join lands on the teams list', () => {
    const destination = destinationFor({ kind: 'joined' });
    expect(settleAt(destination)).toBe('/teams');
  });
});
