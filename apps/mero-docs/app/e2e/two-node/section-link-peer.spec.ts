// A section link survives a peer's edits above the block and opens at the
// section on another member's node.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/two-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** The block's top edge relative to the editor's scroll area. */
async function offsetInScroller(
  page: Page,
  text: string,
): Promise<number | null> {
  const scroller = page.getByTestId('doc-editor').locator('xpath=..');
  const [block, area] = await Promise.all([
    page
      .getByTestId('doc-block')
      .filter({ hasText: text })
      .first()
      .boundingBox(),
    scroller.boundingBox(),
  ]);
  return block && area ? block.y - area.y : null;
}

async function expectLandedOn(
  driver: WorkspaceDriver,
  text: string,
): Promise<void> {
  const { page } = driver;
  await expect(
    page.getByRole('status').filter({ hasText: 'Opened from a link to' }),
  ).toHaveText(`Opened from a link to ${text}`, { timeout: 60_000 });
  await expect
    .poll(() => offsetInScroller(page, text))
    .toBeGreaterThanOrEqual(0);
  await expect.poll(() => offsetInScroller(page, text)).toBeLessThan(120);
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
    await bob.restrictedCard.joinIfPrompted();
    await bob.docs.expectDocVisible('Roadmap');

    await alice.openDoc('Roadmap');
    await alice.editor.expectMounted();
    await alice.editor.type('Intro');
    for (let line = 1; line <= 30; line++) {
      await alice.page.keyboard.press('Enter');
      await alice.page.keyboard.type(`Filler line ${line}`);
    }
    await alice.page.keyboard.press('Enter');
    await alice.page.keyboard.type('# Milestones');
    await alice.page.keyboard.press('Enter');
    await alice.page.keyboard.type('Folder sharing and roles');
  });

  test('still lands on the block after Bob edits above it', async ({
    alice,
    bob,
  }) => {
    const link = await alice.editor.copySectionLink('Milestones');

    await bob.openDoc('Roadmap');
    await bob.editor.expectContent('Milestones');
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
    const docPath = pathOf(alice.page);
    expect(link.pathname).toBe(docPath);

    await bob.page.goto(link.pathname + link.hash);

    await bob.editor.expectMounted({ timeout: 60_000 });
    await expectLandedOn(bob, 'Milestones');
  });
});
