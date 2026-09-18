import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATCH_ALL, ROUTES } from './routes';

const here = resolve(__dirname, '..');

describe('the route table', () => {
  it('has exactly one catch-all', () => {
    // The app used to have TWO nested `<Routes>`, each with its own `path="*"`
    // — one rendering the connect gate inside the sidebar layout, one rendering
    // the dashboard. Two catch-alls that can each render a screen which
    // navigates is the shape a client-side redirect cycle hides in.
    expect(ROUTES.filter((r) => r.path === CATCH_ALL)).toHaveLength(1);
  });

  it('puts the catch-all last, where react-router will only reach it as a fallback', () => {
    expect(ROUTES[ROUTES.length - 1].path).toBe(CATCH_ALL);
  });

  it('declares every path exactly once', () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  // Somebody typed `/landing` and got an infinite redirect. It is a real route
  // now, and it renders the landing page rather than redirecting to `/`.
  it('has a real `/landing`, reachable signed out', () => {
    const landing = ROUTES.find((r) => r.path === '/landing');
    expect(landing).toBeDefined();
    expect(landing?.screen).toBe('landing');
    expect(landing?.publicScreen).toBe(true);
  });

  it('keeps the three landing paths public', () => {
    for (const path of ['/', '/landing', '/docs', '/preview']) {
      expect(ROUTES.find((r) => r.path === path)?.publicScreen).toBe(true);
    }
  });

  it('gates the app screens without making them unreachable by URL', () => {
    // `publicScreen: false` means the connect prompt RENDERS in place of the
    // page — the URL is kept, so signing in lands you where you meant to go.
    for (const path of [
      '/agreements',
      '/agreements/:agreementId',
      '/signatures',
    ]) {
      expect(ROUTES.find((r) => r.path === path)?.publicScreen).toBe(false);
    }
  });

  it('lets an unknown path render something, signed in or out', () => {
    const fallback = ROUTES.find((r) => r.path === CATCH_ALL);
    expect(fallback?.screen).toBe('notFound');
    expect(fallback?.publicScreen).toBe(true);
  });
});

describe('nothing in the routing redirects', () => {
  // The strongest guarantee available: a redirect that cannot fire cannot loop.
  // This asserts the SOURCE, because the property is about what the code is
  // allowed to contain rather than about what one render happens to do.
  const routingFiles = ['src/App.tsx', 'src/routes.ts'];

  it.each(routingFiles)(
    '%s renders no redirect element and rewrites no location',
    (rel) => {
      const src = readFileSync(resolve(here, rel), 'utf8');
      expect(src).not.toMatch(/<Navigate/);
      expect(src).not.toMatch(/window\.location\.(assign|replace)\s*\(/);
      expect(src).not.toMatch(/window\.location\.href\s*=/);
    },
  );

  // ⚠️ NOT a blanket ban on `navigate()`. Redeeming an invitation navigates to
  // the agreement it just joined, and that is a result of an action rather than
  // a routing rule — banning it outright would be asserting the wrong property.
  // What must hold is that nothing navigates while DECIDING what to render,
  // which is the step a cycle needs.
  it('the screen renderer decides what to show without navigating', () => {
    const src = readFileSync(resolve(here, 'src/App.tsx'), 'utf8');
    const start = src.indexOf('function Screenful');
    const end = src.indexOf('function AppContent');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const screenful = src.slice(start, end);
    expect(screenful).not.toMatch(/navigate\s*\(/);
    expect(screenful).not.toMatch(/useNavigate/);
  });

  it('App.tsx renders one <Routes>, driven by the table', () => {
    const src = readFileSync(resolve(here, 'src/App.tsx'), 'utf8');
    expect(src.match(/<Routes>/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/ROUTES\.map/);
  });
});

// ── The actual cause of the reported loop ────────────────────────────────────
//
// `/landing` spiralled into `/landing/?/&/~and~/~and~/…` on the live site. It is
// a GitHub Pages SPA shim (`spa-github-pages`) served as `404.html` with
// `pathSegmentsToKeep = 1`: it rewrites an unknown path to
// `/<first-segment>/?/<rest>`, which with `1` KEEPS the first segment, so the
// redirect target is itself unknown and the shim runs again, re-encoding its own
// query (`&` → `~and~`) every round.
//
// The shim is not in this repo — it is in a very old deployment. These assert it
// cannot come back, which is the part this app can own.
describe('no GitHub Pages redirect shim can ship', () => {
  it('there is no 404.html in public/', () => {
    const pub = resolve(here, 'public');
    const names = existsSync(pub) ? readdirSync(pub) : [];
    expect(names).not.toContain('404.html');
  });

  it('no source file carries the shim', () => {
    for (const rel of ['index.html', 'vite.config.js']) {
      const src = readFileSync(resolve(here, rel), 'utf8');
      expect(src).not.toMatch(/pathSegmentsToKeep/);
      expect(src).not.toMatch(/spa-github-pages/);
    }
  });

  it('the vite build declares no second HTML entry', () => {
    // `rollupOptions.input` naming `public/404.html` is what emitted the shim
    // into `dist/` in the first place.
    const src = readFileSync(resolve(here, 'vite.config.js'), 'utf8');
    expect(src).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/);
  });

  it('vercel.json rewrites every path to the SPA, so nothing 404s into a shim', () => {
    const vercel = JSON.parse(
      readFileSync(resolve(here, 'vercel.json'), 'utf8'),
    );
    const rewrites = vercel.rewrites ?? [];
    expect(rewrites).toContainEqual({
      source: '/(.*)',
      destination: '/index.html',
    });
  });
});
