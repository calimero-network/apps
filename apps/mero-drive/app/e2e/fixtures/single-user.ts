// Single-user fixture for single-node specs. Alice on node-1; tests
// own state lifecycle (create namespace, folders, docs) inside the
// test body, so the fixture is just an authed WorkspaceDriver.

import { test as base } from '@playwright/test';
import { injectMeroAuth } from './auth';
import { envAvailable, getEnv } from './env';
import { WorkspaceDriver } from './workspace';

export interface SingleUserFixtures {
  alice: WorkspaceDriver;
}

export const test = base.extend<SingleUserFixtures>({
  alice: async ({ browser }, use, testInfo) => {
    if (!envAvailable()) {
      testInfo.skip(true, 'integration env not available');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await use(undefined as any);
      return;
    }
    const env = getEnv();
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
});

export { expect } from '@playwright/test';
