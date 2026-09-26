// Folder rows must be selectable without a mouse: the name is a real
// button, so it can be focused and activated with Enter.

import { test, expect } from '../fixtures/single-user';

test.describe('Folder tree keyboard access (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Keyboard WS ${Date.now()}`);
  });

  test('selecting a folder with Enter opens its folder view', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Keyboard Only', visibility: 'Open' });

    const nameButton = alice.tree
      .folderRow('Keyboard Only')
      .getByRole('button', { name: 'Keyboard Only', exact: true });
    await nameButton.focus();
    await alice.page.keyboard.press('Enter');

    await expect(
      alice.page.getByRole('heading', { name: 'No document open' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(alice.tree.folderRow('Keyboard Only')).toHaveClass(
      /bg-selected/,
    );
  });
});
