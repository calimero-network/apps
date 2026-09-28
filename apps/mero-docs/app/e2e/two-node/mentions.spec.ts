// Mentions across nodes: Alice mentions Bob and his Mentioned me lists the doc;
// a mention in a restricted folder Bob is not in warns Alice and never reaches him.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';

const SYNC_MS = 60_000; // one sync round between nodes, with room

async function saved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Mentions (two-node)', () => {
  test.beforeEach(async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Mentions WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Plan');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();
    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.docs.expectDocVisible('Plan', { timeout: SYNC_MS });
  });

  test("Alice mentions Bob, and Bob's Mentioned me lists the doc", async ({
    alice,
    bob,
  }) => {
    await alice.tree.openFolder('Shared');
    await alice.openDoc('Plan');
    await alice.editor.type('Review with ');
    await alice.page.keyboard.type('@bo');
    const option = alice.editor.personOption('bob');
    await expect(option).toBeVisible({ timeout: SYNC_MS });
    await expect(option).not.toContainText("Can't open this folder");
    await option.click();
    await expect(alice.editor.mentionChip('bob')).toBeVisible();
    await saved(alice.page);
    // A click puts the caret in the link; the card stands in for BlockNote's toolbar.
    await alice.editor.mentionChip('bob').click();
    await expect(alice.editor.memberCard()).toBeVisible();
    await expect(alice.editor.linkToolbar()).toHaveCount(0);

    await bob.home.open();
    await expect(bob.home.mentionsRow()).toHaveAccessibleName('Mentions, 1', {
      timeout: SYNC_MS,
    });
    await bob.home.mentionsRow().click();
    await bob.home.expectTitles(['Plan']);
  });

  test("a mention in a folder Bob can't open warns Alice and never reaches Bob", async ({
    alice,
    bob,
  }) => {
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Ledger');
    await alice.openDoc('Ledger');
    await alice.editor.type('Ping ');
    await alice.page.keyboard.type('@bo');
    const option = alice.editor.personOption('bob');
    await expect(option).toContainText("Can't open this folder", {
      timeout: SYNC_MS,
    });
    await option.click();
    await expect(
      alice.page.getByText("bob can't open this folder"),
    ).toBeVisible();
    await expect(alice.editor.mentionChip('bob')).toBeVisible();
    await saved(alice.page);
    await alice.editor.mentionChip('bob').hover();
    await expect(alice.editor.memberCard()).toContainText(
      "Can't open this folder",
    );
    await alice.editor.close();

    // A later mention Bob can read proves his index caught up past Ledger.
    await alice.tree.openFolder('Shared');
    await alice.openDoc('Plan');
    await alice.editor.type('Also ');
    await alice.editor.mention('bo', 'bob');
    await saved(alice.page);

    await bob.home.open();
    await expect(bob.home.mentionsRow()).toHaveAccessibleName('Mentions, 1', {
      timeout: SYNC_MS,
    });
    await bob.home.mentionsRow().click();
    await bob.home.expectTitles(['Plan']);
  });
});
