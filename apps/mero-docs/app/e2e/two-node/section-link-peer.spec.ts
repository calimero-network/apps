// A section link survives a peer's edits above the block and opens at the
// section on another member's node.

import { expect, test } from '../fixtures/two-user';
import {
  SECTIONS_LAST_LINE,
  type WorkspaceDriver,
} from '../fixtures/workspace';

async function expectLandedOn(
  driver: WorkspaceDriver,
  text: string,
): Promise<void> {
  const { page, editor } = driver;
  await expect(
    page.getByRole('status').filter({ hasText: 'Opened from a link to' }),
  ).toHaveText(`Opened from a link to ${text}`, { timeout: 60_000 });
  await expect
    .poll(() => editor.offsetInScroller(text))
    .toBeGreaterThanOrEqual(0);
  await expect.poll(() => editor.offsetInScroller(text)).toBeLessThan(120);
}

test.describe('Section links across nodes (two-node)', () => {
  test.beforeEach(async ({ alice, bob }) => {
    await alice.page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await alice.goToWorkspace();
    await alice.createNamespace(`Section Peer WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Roadmap');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.docs.expectDocVisible('Roadmap');

    await alice.openDoc('Roadmap');
    await alice.editor.expectMounted();
    await alice.editor.writeSections();
  });

  test('still lands on the block after Bob edits above it', async ({
    alice,
    bob,
  }) => {
    const link = await alice.editor.copySectionLink('Milestones');

    await bob.openDoc('Roadmap');
    await bob.editor.expectContent(SECTIONS_LAST_LINE, {
      timeout: 60_000,
    });
    await bob.editor.block('Intro').click();
    await bob.page.keyboard.press('Home');
    for (let line = 1; line <= 5; line++) {
      await bob.page.keyboard.type(`Bob line ${line}`);
      await bob.page.keyboard.press('Enter');
    }
    await alice.editor.expectContent('Bob line 5');

    await alice.page.goto(link);

    await expectLandedOn(alice, 'Milestones');
    await expect(alice.editor.block('Bob line 1')).toBeAttached();
  });

  test("Alice's link opens at the section on Bob's node", async ({
    alice,
    bob,
  }) => {
    const link = new URL(await alice.editor.copySectionLink('Milestones'));
    expect(link.pathname).toBe(new URL(alice.page.url()).pathname);
    // Bob's node must hold the section before the link can land on it.
    await bob.openDoc('Roadmap');
    await bob.editor.expectContent(SECTIONS_LAST_LINE, {
      timeout: 60_000,
    });
    await bob.page.goto('/app');
    await expect(bob.page.getByTestId('workspace-switcher')).toBeVisible({
      timeout: 30_000,
    });

    await bob.page.goto(link.pathname + link.hash);

    await bob.editor.expectMounted({ timeout: 60_000 });
    await expectLandedOn(bob, 'Milestones');
  });
});
