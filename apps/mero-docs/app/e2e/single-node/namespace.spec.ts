// Namespace surface — Alice-only flows on node-1.

import { test, expect } from '../fixtures/single-user';

test.describe('Namespace (single-node)', () => {
  test('create namespace via NamespaceSwitcher', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Alpha');
    await expect(alice.page.getByTestId('workspace-switcher')).toContainText(
      'Phoenix Alpha',
    );
  });

  test('New workspace dialog takes keyboard input without clicking the field', async ({
    alice,
  }) => {
    await alice.goToWorkspace();
    await alice.page.getByTestId('workspace-switcher').click();
    await alice.page.getByRole('menuitem', { name: /New workspace/i }).click();
    const dialog = alice.page
      .getByRole('dialog')
      .filter({ has: alice.page.getByPlaceholder(/Workspace name/i) });
    const input = dialog.getByPlaceholder(/Workspace name/i);
    // No click on the input: focus must land there on open, and the dropdown
    // item that opened the dialog must not steal it back.
    await expect(input).toBeFocused();
    await alice.page.keyboard.type('Typed Without Clicking');
    await expect(input).toHaveValue(
      'Typed Without Clicking',
    );
    await dialog.getByRole('button', { name: /^Cancel$/ }).click();
  });

  test('switch between namespaces', async ({ alice }) => {
    const [a, b] = [`Phoenix A ${Date.now()}`, `Phoenix B ${Date.now()}`];
    await alice.goToWorkspace();
    await alice.createNamespace(a);
    await alice.createNamespace(b);
    await alice.switchNamespace(a);
    await expect(alice.page.getByTestId('workspace-switcher')).toContainText(a);
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
    await alice.openSettings();
    await expect(
      alice.page
        .locator('[data-testid="my-display-name-panel"]')
        .locator('input'),
    ).toHaveValue('Alice From Test', { timeout: 30_000 });
    await alice.closeSettings();
  });

  test('settings closes when picking the folder already open', async ({
    alice,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Same Folder WS');
    await alice.createFolder({ name: 'Foo', visibility: 'Open' });
    await alice.tree.openFolder('Foo');
    await alice.openSettings();
    await alice.tree.openFolder('Foo');
    await expect(
      alice.page.getByText(/Your display name/i),
    ).toBeHidden({ timeout: 5_000 });
  });

  test('settings closes when opening a document', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Doc From Settings WS');
    await alice.createFolder({ name: 'Foo', visibility: 'Open' });
    await alice.tree.openFolder('Foo');
    await alice.createDoc('Notes');
    await alice.openSettings();
    await alice.docs.clickDoc('Notes');
    await expect(
      alice.page.getByText(/Your display name/i),
    ).toBeHidden({ timeout: 5_000 });
    await alice.editor.expectMounted();
  });
});
