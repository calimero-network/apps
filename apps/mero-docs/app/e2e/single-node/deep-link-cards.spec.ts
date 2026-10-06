// A link to a deleted doc, an unknown folder, or a workspace this node
// isn't in shows a card that says why, never a blank screen.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

function homePathOf(page: Page): string {
  const [, app, ws] = pathOf(page).split('/');
  return `/${app}/${ws}`;
}

test.describe('Deep-link cards (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Deep Link Cards WS ${Date.now()}`);
    await alice.createFolder({ name: 'Notes', visibility: 'Open' });
    await alice.tree.openFolder('Notes');
    await alice.createDoc('Kept');
  });

  test('a link to an unknown doc in a real folder shows the doc-worded card', async ({
    alice,
  }) => {
    const home = homePathOf(alice.page);
    await alice.tree.openFolder('Notes');
    const folderPath = pathOf(alice.page);

    await alice.page.goto(`${folderPath}/d/does-not-exist`);

    await expect(
      alice.page.getByText("This document isn't available"),
    ).toBeVisible({ timeout: 30_000 });
    await alice.page.getByRole('button', { name: 'Go to Home' }).click();
    await expect.poll(() => pathOf(alice.page)).toBe(home);
  });

  test('a link to an unknown folder keeps its URL and shows the folder-worded card', async ({
    alice,
  }) => {
    const home = homePathOf(alice.page);
    const link = `${home}/f/does-not-exist/d/does-not-exist`;

    await alice.page.goto(link);

    await expect(
      alice.page.getByText("This folder isn't available"),
    ).toBeVisible({ timeout: 30_000 });
    expect(pathOf(alice.page)).toBe(link);
    await alice.page.getByRole('button', { name: 'Go to Home' }).click();
    await expect.poll(() => pathOf(alice.page)).toBe(home);
  });

  test('a link to a workspace this node is not in shows the not-in-workspace card', async ({
    alice,
  }) => {
    await alice.page.goto('/app/not-a-real-workspace-id');

    await expect(
      alice.page.getByText('You are not in this workspace'),
    ).toBeVisible({ timeout: 30_000 });
    // Go to Home leaves for the visitor's own workspace, not the dead one.
    await alice.page.getByRole('button', { name: 'Go to Home' }).click();
    await expect
      .poll(() => pathOf(alice.page))
      .not.toBe('/app/not-a-real-workspace-id');
    await expect(alice.page.getByTestId('workspace-switcher')).toContainText(
      'Deep Link Cards WS',
    );
  });
});
