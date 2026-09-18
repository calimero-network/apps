// Joining a workspace must be QUIET.
//
// The reported bug: joining fired a burst of ~20 error toasts reading "context
// state not initialized, awaiting state sync". A join is several round trips and
// every read taken during that window failed, each failure raising its own
// toast.
//
// ── Why this records toasts instead of looking for them ──────────────────────
//
// Toasts auto-dismiss. Asserting `toHaveCount(0)` after the join would pass even
// if twenty had come and gone while it was running — the exact bug, invisible to
// the test meant to catch it. So a MutationObserver installed BEFORE the page
// loads appends every toast that ever appears to `window.__toastLog`, and the
// assertions run against that log at the end.
//
// The observer keys on `role="status"`, which is what mero-ui's ToastProvider
// renders each toast as.
import { test, expect, type Page } from '@playwright/test';
import { loginViaHash, clearAuth, inviteAndJoin } from './helpers';

/** Phrases that must never be shown to someone who is merely joining. */
const TRANSIENT_NOISE = /not initialized|awaiting state sync|uninitialized|group key not yet delivered/i;

declare global {
  interface Window {
    __toastLog?: string[];
  }
}

async function recordToasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__toastLog = [];
    const seen = new WeakSet<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll('[role="status"]')) {
        if (seen.has(el)) continue;
        seen.add(el);
        const text = (el.textContent || '').trim();
        if (text) window.__toastLog!.push(text);
      }
    };
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    scan();
  });
}

const toastLog = (page: Page) => page.evaluate(() => window.__toastLog ?? []);

test.describe('joining a workspace is quiet', () => {
  test('a join raises no "not initialized" toasts on either node', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      // Before any navigation, or the first toasts are missed.
      await recordToasts(pageA);
      await recordToasts(pageB);

      await loginViaHash(pageA, 0);
      await loginViaHash(pageB, 1);
      await inviteAndJoin(pageA, pageB);

      // The joiner is the one that used to be buried: it is the node whose
      // context is replicating from scratch.
      const joiner = await toastLog(pageB);
      const inviter = await toastLog(pageA);

      expect(
        joiner.filter((t) => TRANSIENT_NOISE.test(t)),
        `the joiner was shown pre-initialisation errors: ${JSON.stringify(joiner)}`,
      ).toEqual([]);

      expect(
        inviter.filter((t) => TRANSIENT_NOISE.test(t)),
        `the inviter was shown pre-initialisation errors: ${JSON.stringify(inviter)}`,
      ).toEqual([]);

      // And not a burst of anything else either. The original report was "about
      // twenty"; a successful join should raise no error toast at all, so this
      // also catches the same storm re-appearing with different wording.
      expect(
        joiner.length,
        `the joiner was shown unexpected toasts during a successful join: ${JSON.stringify(joiner)}`,
      ).toBeLessThanOrEqual(1);
    } finally {
      await clearAuth(pageA).catch(() => {});
      await clearAuth(pageB).catch(() => {});
      await ctxA.close();
      await ctxB.close();
    }
  });
});
