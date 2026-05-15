// Settings and sharing surface — tests 24-26.

import { test, expect } from '../fixtures/single-user';

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

  test('Visibility toggle dropdown available on owned folder', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Toggleable', visibility: 'Open' });
    await alice.tree.openFolder('Toggleable');
    // FolderVisibilityToggle returns null until `current` is
    // resolved (per-folder getGroupInfo fetch). Wait for the
    // folder-header visibility label so we know that fetch has
    // populated state — radix DropdownMenu is a snapshot at open
    // time and won't re-render new menuitems.
    // 90s — per-folder `getGroupInfo` fan-out in useDriveWorkspace
    // has no rate-limiting; under CI with multiple folders the chip
    // text can lag well past the default 30s. Bumping the wait
    // rather than skipping because the toggle assertion below is
    // the actual signal we care about.
    await expect(
      alice.page.getByText(/Open — namespace members can join/i),
    ).toBeVisible({ timeout: 90_000 });

    await alice.tree.openContextMenu('Toggleable');
    await expect(
      alice.page.getByRole('menuitem', { name: /Make restricted/i }),
    ).toBeVisible({ timeout: 10_000 });
    await alice.page.keyboard.press('Escape');
  });

  test('Visibility toggle dropdown shows exactly one option per state', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Settled', visibility: 'Open' });
    await alice.tree.openFolder('Settled');
    // 90s — per-folder `getGroupInfo` fan-out in useDriveWorkspace
    // has no rate-limiting; under CI with multiple folders the chip
    // text can lag well past the default 30s. Bumping the wait
    // rather than skipping because the toggle assertion below is
    // the actual signal we care about.
    await expect(
      alice.page.getByText(/Open — namespace members can join/i),
    ).toBeVisible({ timeout: 90_000 });

    await alice.tree.openContextMenu('Settled');
    const restrictItem = alice.page.getByRole('menuitem', {
      name: /Make restricted/i,
    });
    const openItem = alice.page.getByRole('menuitem', {
      name: /Make open/i,
    });
    const restrictCount = await restrictItem.count();
    const openCount = await openItem.count();
    // Exactly one of the two should be present — never zero (would
    // imply the toggle didn't render at all), never both
    // (duplicate render). For an Open folder we expect
    // "Make restricted" specifically.
    expect(restrictCount + openCount).toBe(1);
    expect(restrictCount).toBe(1);
    await alice.page.keyboard.press('Escape');
  });
});
