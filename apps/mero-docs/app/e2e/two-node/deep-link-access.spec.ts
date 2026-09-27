// A link into a restricted folder shows a card naming it instead of
// silently dropping the visitor on Home; the same link opens the doc once
// the folder owner adds them.

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
      bob.page.getByText('This document is in Finance'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      bob.page.getByText(
        'Finance is a restricted folder, and you are not a member yet. Ask a folder manager to add you, then open this link again.',
      ),
    ).toBeVisible();

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
});
