/**
 * Mount the shared landing page in front of the game launcher.
 *
 * HAND-OWNED. Mero Blocks boots from `main.ts` with no React in the entry path, and its
 * `Landing` (`src/ui/landing.ts`) is an imperative launcher resolving a
 * `LaunchChoice` the game awaits. Rather than rewrite any of that, this renders
 * the marketing page into a throwaway root and resolves when the CTA is
 * clicked; `main.ts` then hands off to the launcher exactly as before.
 *
 * Deliberately skipped when:
 *   - the URL carries `?invitation=` — a join link must never be interrupted;
 *   - it has already been shown this session — returning to play should not
 *     pay for the pitch twice.
 */
import { createRoot } from 'react-dom/client';

import LandingPage from './LandingPage';

const SEEN = 'cal-lp-seen';

/**
 * Put the address bar back on the launcher's own route.
 *
 * ⚠️ The landing page's nav is REAL routing — `/docs` and `/preview` are
 * pushed onto the history. Without this, a visitor who read the docs before
 * pressing Connect leaves the launcher parked on `/docs`, so a reload (or the
 * desktop app reopening the window) lands on a route the game does not serve.
 *
 * The search and hash are carried over untouched: `?invitation=` is how a join
 * link arrives, and the hash is where desktop SSO puts its tokens. Dropping
 * either would break a flow that has nothing to do with which page was read.
 */
function resetPath(): void {
  if (window.location.pathname === '/') return;
  try {
    window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
  } catch {
    /* a sandboxed iframe cannot replaceState; the page still works */
  }
}

/** Render the page over whatever is on screen; resolve when the CTA is hit. */
function mount(): Promise<void> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    // z-index 50 puts this over the launcher (20), which is what lets the
    // launcher's own "back to landing" simply render this on top of it rather
    // than tearing itself down and rebuilding.
    host.style.cssText = 'position:fixed;inset:0;z-index:50;overflow-y:auto';
    document.body.appendChild(host);
    const root = createRoot(host);

    const done = () => {
      try {
        sessionStorage.setItem(SEEN, '1');
      } catch {
        /* ignore */
      }
      resetPath();
      root.unmount();
      host.remove();
      resolve();
    };

    root.render(<LandingPage onConnect={done} />);
  });
}

/**
 * @returns `true` if the landing page was actually shown, so the caller can
 *   render the launcher CHROMELESS — straight to the world picker, without
 *   repeating a logo and a pitch the visitor just read.
 */
export function showLandingOnce(): Promise<boolean> {
  const url = new URL(window.location.href);
  if (url.searchParams.has('invitation')) return Promise.resolve(false);
  try {
    if (sessionStorage.getItem(SEEN) === '1') return Promise.resolve(false);
  } catch {
    /* a private window is not a reason to block the game */
  }

  return mount().then(() => true);
}

/**
 * Show it again, because the visitor asked to.
 *
 * The launcher's "Back to landing page" button. None of `showLandingOnce`'s
 * guards apply here — the once-a-session rule exists so nobody is made to read
 * the pitch twice, not to stop someone who wants to. Resolves when they leave
 * it again, which needs no handling: the launcher was never unmounted, so
 * dismissing this simply uncovers it.
 */
export function showLandingAgain(): Promise<void> {
  // Always open on the overview. The visitor may have left the page on /docs
  // last time, and "back to the landing page" does not mean "back to page
  // three of the manual".
  resetPath();
  return mount();
}
