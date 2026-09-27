// Every screen has a URL: reload, back/forward, a signed-out deep link and
// Copy link all land on the same screen.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import { injectMeroAuth } from '../fixtures/auth';
import { getEnv } from '../fixtures/env';

const DOC_PATH = /^\/app\/[^/]+\/f\/[^/]+\/d\/doc-\d+$/; // /app/<ws>/f/<folder>/d/<doc>

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

// `/app/<ws>` for the workspace the page is in.
function homePathOf(page: Page): string {
  const [, app, ws] = pathOf(page).split('/');
  return `/${app}/${ws}`;
}

test.describe('URL routing (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Route WS ${Date.now()}`);
    await alice.createFolder({ name: 'Drafts', visibility: 'Open' });
    await alice.tree.openFolder('Drafts');
    await alice.createDoc('Linked');
  });

  test('/app opens the last workspace', async ({ alice }) => {
    const home = homePathOf(alice.page);
    await alice.page.goto('/app');
    await expect.poll(() => pathOf(alice.page), { timeout: 30_000 }).toBe(home);
    await expect(alice.page.getByTestId('workspace-switcher')).toContainText(
      'Route WS',
    );
  });

  test('reload keeps the open doc', async ({ alice }) => {
    await alice.openDoc('Linked');
    await expect.poll(() => pathOf(alice.page)).toMatch(DOC_PATH);
    const docPath = pathOf(alice.page);

    await alice.page.reload();

    await alice.editor.expectMounted();
    await expect(alice.page.getByTestId('doc-title-input')).toHaveValue('Linked', {
      timeout: 15_000,
    });
    expect(pathOf(alice.page)).toBe(docPath);
  });

  test('back and forward walk Home, folder, doc and settings', async ({ alice }) => {
    const page = alice.page;
    const home = homePathOf(page);
    await page.goto(home);
    await expect(page.getByTestId('workspace-switcher')).toContainText('Route WS', {
      timeout: 30_000,
    });

    await alice.tree.openFolder('Drafts');
    const folder = pathOf(page);
    expect(folder).toMatch(new RegExp(`^${home}/f/[^/]+$`));
    await alice.openDoc('Linked');
    const doc = pathOf(page);
    expect(doc).toMatch(DOC_PATH);
    await alice.openSettings();
    expect(pathOf(page)).toBe(`${home}/settings`);

    await page.goBack();
    await alice.editor.expectMounted();
    expect(pathOf(page)).toBe(doc);

    await page.goBack();
    await expect(page.getByRole('heading', { name: /No document open/i })).toBeVisible();
    expect(pathOf(page)).toBe(folder);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Select a folder' })).toBeVisible();
    expect(pathOf(page)).toBe(home);

    await page.goForward();
    await page.goForward();
    await alice.editor.expectMounted();
    expect(pathOf(page)).toBe(doc);

    await page.goForward();
    await expect(page.getByText(/Your display name/i).first()).toBeVisible();
    expect(pathOf(page)).toBe(`${home}/settings`);

    // The Settings toggle closes back to the doc it was opened from.
    await alice.closeSettings();
    await alice.editor.expectMounted();
    expect(pathOf(page)).toBe(doc);
  });

  test('a signed-out doc link lands on the doc after sign-in', async ({
    alice,
    browser,
  }) => {
    await alice.openDoc('Linked');
    await expect.poll(() => pathOf(alice.page)).toMatch(DOC_PATH);
    const docPath = pathOf(alice.page);

    const ctx = await browser.newContext();
    try {
      const visitor = await ctx.newPage();
      await visitor.goto(docPath);
      await expect.poll(() => pathOf(visitor), { timeout: 30_000 }).toBe('/');

      // Sign-in returns to `/` with a session; the init script stands in for
      // the SSO callback storing it before the app boots.
      const env = getEnv();
      await injectMeroAuth(visitor, {
        nodeUrl: env.node1.url,
        accessToken: env.node1.accessToken,
        refreshToken: env.node1.refreshToken,
        applicationId: env.applicationId,
      });
      await visitor.goto('/');

      await expect.poll(() => pathOf(visitor), { timeout: 30_000 }).toBe(docPath);
      await expect(visitor.locator('.ProseMirror').first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(visitor.getByTestId('doc-title-input')).toHaveValue('Linked', {
        timeout: 15_000,
      });
    } finally {
      await ctx.close();
    }
  });

  test('Copy link puts the doc URL on the clipboard', async ({ alice }) => {
    const page = alice.page;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await alice.openDoc('Linked');
    await expect.poll(() => pathOf(page)).toMatch(DOC_PATH);

    await page.getByRole('button', { name: 'Copy link' }).click();

    await expect(page.getByText('Link copied')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(new URL(pathOf(page), page.url()).href);
  });
});
