/**
 * Mount the shared landing page in front of the game launcher.
 *
 * HAND-OWNED. Merraria boots from `main.ts` with no React in the entry path, and its
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

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:50;overflow-y:auto';
    document.body.appendChild(host);
    const root = createRoot(host);

    const done = () => {
      try {
        sessionStorage.setItem(SEEN, '1');
      } catch {
        /* ignore */
      }
      root.unmount();
      host.remove();
      resolve(true);
    };

    root.render(<LandingPage onConnect={done} />);
  });
}
