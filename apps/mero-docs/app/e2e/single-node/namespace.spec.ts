// Namespace surface - Alice-only flows on node-1.

import { test, expect } from '../fixtures/single-user';
import { getEnv } from '../fixtures/env';

const NODE_PAGE = 100; // core's default page for the namespace list
const EVERY_NAMESPACE = 10_000; // a limit above any node this suite builds

interface ListedNamespace {
  namespaceId: string;
  name?: string;
}

test.describe('Namespace (single-node)', () => {
  test('a workspace past the node’s first page still names itself in the switcher', async ({
    alice,
  }) => {
    const env = getEnv();
    const headers = { Authorization: `Bearer ${env.node1.accessToken}` };
    const listAll = async (): Promise<ListedNamespace[]> => {
      const res = await alice.page.request.get(
        `${env.node1.url}/admin-api/namespaces/for-application/${env.applicationId}?limit=${EVERY_NAMESPACE}`,
        { headers },
      );
      expect(res.ok()).toBe(true);
      return (await res.json()).data;
    };
    for (let n = (await listAll()).length; n <= NODE_PAGE; n++) {
      const res = await alice.page.request.post(
        `${env.node1.url}/admin-api/namespaces`,
        { headers, data: { applicationId: env.applicationId, name: `Page Two ${n}` } },
      );
      expect(res.ok()).toBe(true);
    }
    // The node pages in id order, so the largest id is never on the first page.
    const last = (await listAll()).reduce((a, b) =>
      a.namespaceId > b.namespaceId ? a : b,
    );
    expect(last.name).toBeTruthy();

    await alice.page.goto(`/app/${last.namespaceId}`);
    await expect(alice.page.getByTestId('workspace-switcher')).toContainText(
      last.name!,
      { timeout: 15_000 },
    );
  });

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

  test('empty workspace asks for its first folder', async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Empty WS');
    await expect(
      alice.page.getByRole('heading', { name: 'No folders yet' }),
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
