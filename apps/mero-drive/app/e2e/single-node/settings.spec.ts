// Settings and sharing surface — tests 24-26.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

test.describe('Settings + sharing (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Settings WS ${Date.now()}`);
  });

  test('FolderSharingPanel renders member list for Restricted folder', async ({
    alice,
  }) => {
    await alice.createFolder({
      name: 'Restricted Sharing',
      visibility: 'Restricted',
    });
    await alice.tree.openFolder('Restricted Sharing');
    await expect(
      alice.page.getByRole('heading', { name: /^Members$/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      alice.page.getByPlaceholder(/identity pubkey/i),
    ).toBeVisible();
  });

  // Retry-open helper: radix DropdownMenu snapshots its children at
  // open time, so if FolderVisibilityToggle returns null (because
  // `current` visibility hasn't resolved through the per-folder
  // getGroupInfo fan-out yet), the menuitem just isn't there.
  // Re-opening the menu re-renders FolderVisibilityToggle against
  // the latest state, so we poll-by-reopen until the visibility
  // option appears.
  //
  // Replaces a 90s `getByText(/Open — namespace.../)` wait that was
  // brittle under CI — the chip text and the toggle item both go
  // through the same hydration path, so polling the actual signal
  // (the menuitem) is more direct than polling a sibling.
  async function reopenUntilToggleVisible(
    page: Page,
    alice: WorkspaceDriver,
    folderName: string,
    timeoutMs = 120_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await alice.tree.openContextMenu(folderName);
      const item = page.getByRole('menuitem', {
        name: /Make (restricted|open)/i,
      });
      try {
        await expect(item).toBeVisible({ timeout: 4_000 });
        return;
      } catch {
        // Close, give the per-folder fetch a moment, retry.
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden({ timeout: 5_000 });
      }
    }
    throw new Error(
      `visibility toggle menuitem never appeared after ${timeoutMs}ms of retries`,
    );
  }

  test('Visibility toggle dropdown available on owned folder', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Toggleable', visibility: 'Open' });
    await alice.tree.openFolder('Toggleable');
    await reopenUntilToggleVisible(alice.page, alice, 'Toggleable');
    await expect(
      alice.page.getByRole('menuitem', { name: /Make restricted/i }),
    ).toBeVisible();
    await alice.page.keyboard.press('Escape');
  });

  test('Visibility toggle dropdown shows exactly one option per state', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Settled', visibility: 'Open' });
    await alice.tree.openFolder('Settled');
    await reopenUntilToggleVisible(alice.page, alice, 'Settled');
    const restrictCount = await alice.page
      .getByRole('menuitem', { name: /Make restricted/i })
      .count();
    const openCount = await alice.page
      .getByRole('menuitem', { name: /Make open/i })
      .count();
    // For an Open folder we expect "Make restricted" (and only it).
    expect(restrictCount + openCount).toBe(1);
    expect(restrictCount).toBe(1);
    await alice.page.keyboard.press('Escape');
  });
});
