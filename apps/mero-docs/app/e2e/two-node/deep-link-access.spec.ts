// A link into a restricted folder the visitor was not added to says only that
// it is not available - never its name, nor that it exists - and opens the doc
// once the folder owner adds them. A doc link to it says the same on hover.

import { test, expect } from '../fixtures/two-user';

function pathOf(page: { url(): string }): string {
  return new URL(page.url()).pathname;
}

test.describe('Deep link into a restricted folder (two-node)', () => {
  test("Bob's link opens once Alice adds him", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Deep Link WS');
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Ledger');
    await alice.openDoc('Ledger');
    const docPath = pathOf(alice.page);

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // Bob joins the workspace but is not yet a Finance member.
    await bob.joinNamespace(inviteUrl);
    await bob.page.goto(docPath);

    await expect(
      bob.page.getByRole('heading', { name: "This document isn't available" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(bob.page.getByText('Finance')).toHaveCount(0);

    await alice.openFolderInfo('Finance');
    await alice.sharing.addMember('bob');
    await alice.sharing.expectMemberVisible('bob');
    await alice.closeFolderInfo();

    // Same link, no re-navigation needed once access resolves.
    await bob.page.goto(docPath);
    await bob.editor.expectMounted({ timeout: 60_000 });
    await expect(bob.page.getByTestId('doc-title-input')).toHaveValue(
      'Ledger',
      { timeout: 15_000 },
    );
  });

  test("Bob's link to the folder itself names nothing", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Folder Link WS');
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Ledger');
    const folderPath = pathOf(alice.page);

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();
    await bob.joinNamespace(inviteUrl);
    await bob.page.goto(folderPath);

    await expect(
      bob.page.getByRole('heading', { name: "This folder isn't available" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(bob.page.getByText('Finance')).toHaveCount(0);
  });

  test("Bob's doc link into a folder he cannot open says so (L-21)", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Doc Link Access WS');
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Ledger');
    await alice.openDoc('Ledger');
    const ledgerPath = pathOf(alice.page);
    await alice.editor.close();
    await alice.tree.openFolder('Product');
    await alice.createDoc('Plan');
    await alice.openDoc('Plan');
    await alice.editor.type('Numbers live in ');
    await alice.editor.linkDoc('led', /Ledger/);
    await expect(alice.page.getByText('Saved', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();
    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Product');
    await bob.openDoc('Plan');

    const link = bob.editor.docLink('Ledger');
    await expect(link).toBeVisible({ timeout: 60_000 });
    await link.hover();
    await expect(bob.editor.linkCard()).toHaveText(
      "This document isn't available",
      { timeout: 30_000 },
    );

    await link.click();
    await expect.poll(() => pathOf(bob.page)).toBe(ledgerPath);
    await expect(
      bob.page.getByRole('heading', { name: "This document isn't available" }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
