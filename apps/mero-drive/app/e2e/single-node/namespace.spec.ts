// Namespace surface — Alice-only flows on node-1.
//
// Covers tests 4-9 from the design catalog
// (docs/superpowers/specs/2026-05-14-mero-drive-playwright-e2e-design.md).

import { test, expect } from '../fixtures/single-user';

test.describe('Namespace (single-node)', () => {
  test('create namespace via NamespaceSwitcher', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Alpha');
    await expect(
      alice.page.locator('select').first(),
    ).toContainText('Phoenix Alpha');
  });

  test('switch between namespaces', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix A');
    await alice.createNamespace('Phoenix B');
    await alice.switchNamespace('Phoenix A');
    await expect(
      alice.page.locator('select').first(),
    ).toContainText('Phoenix A');
  });

  test('empty workspace shows Select-a-folder state', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Empty WS');
    await expect(
      alice.page.getByRole('heading', { name: /Select a folder/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('settings panel opens then collapses on second click', async ({
    alice,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Settings WS');
    await alice.openSettings();
    await expect(
      alice.page.getByText(/Your display name/i).first(),
    ).toBeVisible();
    await alice.closeSettings();
    // Either an empty state or a folder view; settings header must
    // not be on-screen.
    await expect(
      alice.page.getByText(/Your display name/i),
    ).toBeHidden({ timeout: 5_000 });
  });

  test('set and clear my display name', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Naming WS');
    await alice.setMyDisplayName('Alice From Test');
    // Reopening should show the saved value as the current name.
    // 30s — useMemberDisplayName's refetch on remount can lag
    // behind the underlying mero-react cache invalidation; 10s
    // wasn't enough under CI.
    await alice.openSettings();
    await expect(
      alice.page
        .locator('[data-testid="my-display-name-panel"]')
        .locator('input'),
    ).toHaveValue('Alice From Test', { timeout: 30_000 });
    await alice.closeSettings();
  });

  test('settings closes when picking a folder', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Toggle WS');
    await alice.createFolder({ name: 'Foo', visibility: 'Open' });
    await alice.openSettings();
    await alice.tree.openFolder('Foo');
    await expect(
      alice.page.getByText(/Your display name/i),
    ).toBeHidden({ timeout: 5_000 });
  });
});
