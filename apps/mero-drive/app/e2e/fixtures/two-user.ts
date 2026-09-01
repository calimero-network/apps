// Two-browser-context Playwright fixture: { alice, bob } where each
// is a WorkspaceDriver backed by its own BrowserContext authed to a
// different merod node. Used by every two-node spec; without it
// you'd have to recreate the context boilerplate per test.

import { test as base } from '@playwright/test';
import { injectMeroAuth } from './auth';
import { envAvailable, getEnv } from './env';
import { WorkspaceDriver } from './workspace';

export interface TwoUserFixtures {
  alice: WorkspaceDriver;
  bob: WorkspaceDriver;
}

export const test = base.extend<TwoUserFixtures>({
  alice: async ({ browser }, use, testInfo) => {
    if (!envAvailable({ twoNode: true })) {
      testInfo.skip(true, 'two-node integration env not available');
      // Unreachable, but TS needs a value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await use(undefined as any);
      return;
    }
    const env = getEnv({ twoNode: true });
    const ctx = await browser.newContext();
    await injectMeroAuth(ctx, {
      nodeUrl: env.node1.url,
      accessToken: env.node1.accessToken,
      refreshToken: env.node1.refreshToken,
      applicationId: env.applicationId,
    });
    const page = await ctx.newPage();
    await use(new WorkspaceDriver(page, { label: 'alice' }));
    await ctx.close();
  },
  bob: async ({ browser }, use, testInfo) => {
    if (!envAvailable({ twoNode: true })) {
      testInfo.skip(true, 'two-node integration env not available');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await use(undefined as any);
      return;
    }
    const env = getEnv({ twoNode: true });
    const ctx = await browser.newContext();
    await injectMeroAuth(ctx, {
      nodeUrl: env.node2!.url,
      accessToken: env.node2!.accessToken,
      refreshToken: env.node2!.refreshToken,
      applicationId: env.applicationId,
    });
    const page = await ctx.newPage();
    await use(new WorkspaceDriver(page, { label: 'bob' }));
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
