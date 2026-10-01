// Copy link to section, and opening such a link: it lands on the block with a banner,
// falls back to the top when the block is gone, and adds no history entry of its own.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import { SECTION_PARAGRAPH } from '../fixtures/workspace';

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

function homePathOf(page: Page): string {
  const [, app, ws] = pathOf(page).split('/');
  return `/${app}/${ws}`;
}

test.describe('Section links (single-node)', () => {
  let docPath = '';

  test.beforeEach(async ({ alice }) => {
    await alice.page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await alice.goToWorkspace();
    await alice.createNamespace(`Section Links WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Launch plan');
    await alice.openDoc('Launch plan');
    await alice.editor.expectMounted();
    docPath = pathOf(alice.page);
    await alice.editor.writeSections();
  });

  test('copies a link to a heading, named in the toast', async ({ alice }) => {
    const copied = await alice.editor.copySectionLink('Milestones');

    await expect(
      alice.page.getByText('Link to "Milestones" copied'),
    ).toBeVisible();
    const url = new URL(copied);
    expect(url.origin).toBe(new URL(alice.page.url()).origin);
    expect(url.pathname).toBe(docPath);
    // The link carries the node's id for the block; a block typed this session keeps
    // its editor id in the DOM until the document is loaded from the node again.
    await expect(alice.page.getByText('Saved', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await alice.page.reload();
    await alice.editor.expectMounted();
    const blockId = await alice.editor
      .block('Milestones')
      .getAttribute('data-id');
    expect(url.hash).toBe(`#${new URLSearchParams({ b: blockId ?? '' })}`);
  });

  test('names a paragraph by its first 40 characters', async ({ alice }) => {
    await alice.editor.copySectionLink(SECTION_PARAGRAPH);

    await expect(
      alice.page.getByText(
        'Link to "Pricing follows the model in Pricing not…" copied',
      ),
    ).toBeVisible();
  });

  test('opens a section link at the block, with a banner', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    const link = await editor.copySectionLink('Milestones');
    // A reload before the save lands opens a shorter document, which cannot scroll the block to the top.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.goto(homePathOf(page));
    await expect(page.getByTestId('workspace-switcher')).toContainText(
      'Section Links WS',
      {
        timeout: 30_000,
      },
    );

    await page.goto(link);

    // The wash lasts 1.6 s and starts with the banner, so it is checked first.
    await expect(editor.block('Milestones')).toHaveClass(/section-wash/, {
      timeout: 30_000,
    });
    const banner = page
      .getByRole('status')
      .filter({ hasText: 'Opened from a link to' });
    await expect(banner).toHaveText('Opened from a link to Milestones');
    await expect
      .poll(() => editor.offsetInScroller('Milestones'))
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => editor.offsetInScroller('Milestones'))
      .toBeLessThan(120);
    await expect(editor.block('Milestones')).not.toHaveClass(/section-wash/, {
      timeout: 5_000,
    });

    await page.getByRole('button', { name: 'Go to top' }).click();
    await expect.poll(() => editor.offsetInScroller('Intro')).toBeLessThan(120);
    await expect
      .poll(() => editor.offsetInScroller('Intro'))
      .toBeGreaterThanOrEqual(0);

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });

  test('opens at the top with a banner when the section was removed', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    const link = await editor.copySectionLink('Milestones');
    await editor.openBlockMenu('Milestones');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(
      page.getByTestId('doc-block').filter({ hasText: 'Milestones' }),
    ).toHaveCount(0);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(link);

    await expect(
      page.getByText(
        'That section was removed, so you are at the top of the document',
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => editor.offsetInScroller('Intro')).toBeLessThan(120);
    await expect
      .poll(() => editor.offsetInScroller('Intro'))
      .toBeGreaterThanOrEqual(0);
  });

  test('Back after following a link returns to where you were', async ({
    alice,
  }) => {
    const { page } = alice;
    const link = await alice.editor.copySectionLink('Milestones');
    const home = homePathOf(page);
    await page.goto(home);
    await expect(page.getByTestId('workspace-switcher')).toContainText(
      'Section Links WS',
      {
        timeout: 30_000,
      },
    );

    await page.goto(link);
    await expect(page.getByText('Opened from a link to')).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).hash).toBe(new URL(link).hash);

    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe(home);
  });
});
