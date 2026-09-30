// Two-browser-context Playwright fixture: { alice, bob } where each
// is a WorkspaceDriver backed by its own BrowserContext authed to a
// different merod node. Used by every two-node spec; without it
// you'd have to recreate the context boilerplate per test.

import { test as base } from '@playwright/test';
import { injectMeroAuth } from './auth';
import { envAvailable, getEnv } from './env';
import { WorkspaceDriver } from './workspace';

export const SYNC_MS = 60_000; // a write or a role change crossing to the other node

export interface TwoUserFixtures {
  alice: WorkspaceDriver;
  bob: WorkspaceDriver;
}

export const test = base.extend<TwoUserFixtures>({
  alice: async ({ browser }, use, testInfo) => {
    if (!process.env.CI && !envAvailable({ twoNode: true })) {
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
    if (!process.env.CI && !envAvailable({ twoNode: true })) {
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

// Alice owns an Open folder "Team" holding the doc "Plan"; Bob has joined and sees it.
export async function shareOpenDoc(
  alice: WorkspaceDriver,
  bob: WorkspaceDriver,
  ws: string,
) {
  await alice.goToWorkspace();
  await alice.createNamespace(ws);
  await alice.createFolder({ name: 'Team', visibility: 'Open' });
  await alice.tree.openFolder('Team');
  await alice.createDoc('Plan');
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await alice.closeSettings();

  await bob.joinNamespace(inviteUrl);
  await bob.tree.expectFolderVisible('Team', { timeout: SYNC_MS });
  await bob.tree.openFolder('Team');
  await bob.restrictedCard.joinIfPrompted('Team');
  await bob.docs.expectDocVisible('Plan', { timeout: SYNC_MS });
}

export { expect } from '@playwright/test';
