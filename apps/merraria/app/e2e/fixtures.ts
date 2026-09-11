/**
 * This directory's `test`, with the marketing landing already dismissed.
 *
 * `main.ts` shows the shared Calimero landing page in front of the launcher
 * once per browser session (see src/pages/landing/mount.tsx). Every spec here
 * except `marketing-landing.spec.ts` is about what happens AFTER that — the
 * launcher, login, and the game itself — and Playwright gives each test a fresh
 * session, so without this they would all be stuck reading the pitch.
 *
 * `marketing-landing.spec.ts` imports straight from `@playwright/test` on
 * purpose, so the page it asserts is the one a first visitor actually sees.
 */
import { test as base } from "@playwright/test";

export const test = base.extend<{ landingDismissed: void }>({
  landingDismissed: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        try {
          sessionStorage.setItem("cal-lp-seen", "1");
        } catch {
          /* a private window is not a reason to fail the run */
        }
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
