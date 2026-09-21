// ── The route table, as data ─────────────────────────────────────────────────
//
// Exported so the tests can assert properties of the REAL table rather than of a
// parallel copy that drifts. `App.tsx` maps over exactly this.
//
// ── Why this file exists at all: the `/landing` redirect loop ────────────────
//
// Reported as "we do /landing it starts throwing /~&~&~&/// all the time, some
// recursive error". Reproduced against https://mero-sign.vercel.app/landing:
// 864 navigations in six seconds, the URL growing without bound —
//
//   /landing
//   /landing/?/
//   /landing/?/&/
//   /landing/?/&/~and~/
//   /landing/?/&/~and~/~and~/            … and so on, forever
//
// The cause is NOT this app's routing. The live deployment serves a GitHub Pages
// SPA shim as its `404.html` (`spa-github-pages`, `pathSegmentsToKeep = 1`),
// which rewrites an unknown path into `/<first-segment>/?/<rest>` with `&`
// encoded as `~and~`. With `pathSegmentsToKeep = 1` the first segment is KEPT,
// so the redirect target — `/landing/?/` — is itself an unknown path, which
// serves the shim again, which redirects again. Each round re-encodes the query
// it just produced, which is where the `~and~` chain comes from. `1` is the
// setting for a GitHub *Project Pages* site served under `/repo-name/`; on a
// root domain it must be `0`, and on Vercel the shim must not be there at all.
//
// That shim is not in this repo — there is no `404.html`, `vercel.json` has a
// normal SPA rewrite, and a fresh `vite build` emits no such file. The live site
// is simply a very old build: it serves `assets/main-*.js` where this repo emits
// `assets/index-*.js`, and its `<title>` is `MeroSign` where this repo's is
// `Mero Sign` — which `scripts/check-live-frontends.py` has been warning about.
// So the loop dies the moment this repo's build is actually deployed.
//
// What is fixed HERE is the part that is this app's to own, because "the deploy
// is stale" is not a thing a user can act on:
//
//   1. `/landing` is a real route. Somebody typed it expecting a landing page;
//      now they get one.
//   2. There is ONE route table with ONE catch-all. There used to be two nested
//      `<Routes>`, each with its own `path="*"` — one rendering the connect gate
//      inside the sidebar layout, one rendering the dashboard. Two catch-alls
//      that can each render a screen which navigates is where a client-side
//      cycle would hide.
//   3. **Nothing in this table redirects.** No redirect element, no navigation
//      on mount, anywhere in the routing. An unknown path renders a terminal
//      "not found" screen with links; it does not bounce. A redirect that cannot
//      fire cannot loop, which is a stronger guarantee than a correct redirect.

/** Which screen a path shows. `landing` and `notFound` render signed-out too. */
export type Screen =
  | 'landing'
  | 'workspaces'
  | 'agreements'
  | 'agreement'
  | 'signatures'
  | 'notFound';

export interface RouteDef {
  path: string;
  screen: Screen;
  /**
   * True when a signed-out visitor sees this screen as-is. False means the
   * connect screen stands in — as a RENDER, never a redirect, so the URL the
   * visitor typed survives the login and they land where they meant to.
   */
  publicScreen: boolean;
}

/**
 * `/landing` is an alias of `/`, not a redirect to it.
 *
 * A redirect would have been the obvious fix and is the wrong one: it puts a
 * navigation back into the exact code path that was reported as looping. An
 * alias renders the same screen at the URL that was asked for and stops.
 *
 * (The redirect element's name is deliberately not written anywhere in this
 * file or in App.tsx — `routes.test.ts` greps for it.)
 */
export const ROUTES: readonly RouteDef[] = [
  { path: '/', screen: 'landing', publicScreen: true },
  { path: '/landing', screen: 'landing', publicScreen: true },
  { path: '/docs', screen: 'landing', publicScreen: true },
  { path: '/preview', screen: 'landing', publicScreen: true },
  { path: '/workspaces', screen: 'workspaces', publicScreen: false },
  // The agreements inside one workspace. `/agreements` below shows the same
  // screen for whichever workspace is active, so a link to a workspace and the
  // app's own navigation land in the same place.
  {
    path: '/workspaces/:workspaceId',
    screen: 'agreements',
    publicScreen: false,
  },
  { path: '/agreements', screen: 'agreements', publicScreen: false },
  {
    path: '/agreements/:agreementId',
    screen: 'agreement',
    publicScreen: false,
  },
  { path: '/signatures', screen: 'signatures', publicScreen: false },
  { path: '*', screen: 'notFound', publicScreen: true },
];

/** The catch-all, which must exist exactly once. */
export const CATCH_ALL = '*';

/**
 * What a signed-in visitor sees at `/`.
 *
 * Expressed as a RENDER decision in `App.tsx`, not a redirect: a signed-in
 * person at `/` is shown their workspaces without the URL changing underneath
 * them. The landing page stays reachable at `/landing` whether or not you are
 * signed in, which is what makes it a front door rather than a fallback.
 *
 * The workspace picker rather than the agreements list, because an agreement
 * cannot exist outside a workspace: rc.41 binds every context to a group, so
 * "your agreements" with no workspace chosen is a screen whose only button
 * cannot work. See `lib/agreements`.
 */
export const HOME_SCREEN_WHEN_SIGNED_IN: Screen = 'workspaces';
