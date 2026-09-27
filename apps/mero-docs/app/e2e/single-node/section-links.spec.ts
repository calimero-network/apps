// Copy link to section from the block menu, and opening such a link: it lands
// on the block with a banner, falls back to the top when the block is gone,
// and never adds a history entry of its own.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

const FILLER_LINES = 30; // enough text above the heading that landing on it needs a scroll
const PARAGRAPH =
  'Pricing follows the model in Pricing notes, and the story lives in the blog';

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

function homePathOf(page: Page): string {
  const [, app, ws] = pathOf(page).split('/');
  return `/${app}/${ws}`;
}

// A long intro, then a "Milestones" heading and a paragraph under it.
async function writeSections(alice: WorkspaceDriver): Promise<void> {
  const { page } = alice;
  await alice.editor.type('Intro');
  for (let line = 1; line <= FILLER_LINES; line++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Filler line ${line}`);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Milestones');
  await page.keyboard.press('Enter');
  await page.keyboard.type(PARAGRAPH);
  await expect(alice.editor.block('Milestones').locator('h1')).toBeVisible();
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
    await writeSections(alice);
  });

  test('copies a link to a heading, named in the toast', async ({ alice }) => {
    const copied = await alice.editor.copySectionLink('Milestones');

    await expect(
      alice.page.getByText('Link to "Milestones" copied'),
    ).toBeVisible();
    const blockId = await alice.editor
      .block('Milestones')
      .getAttribute('data-block-id');
    const url = new URL(copied);
    expect(url.origin).toBe(new URL(alice.page.url()).origin);
    expect(url.pathname).toBe(docPath);
    expect(url.hash).toBe(`#${new URLSearchParams({ b: blockId ?? '' })}`);
  });

  test('names a paragraph by its first 40 characters', async ({ alice }) => {
    await alice.editor.copySectionLink(PARAGRAPH);

    await expect(
      alice.page.getByText(
        'Link to "Pricing follows the model in Pricing not…" copied',
      ),
    ).toBeVisible();
  });

  test('opens a section link at the block, with a banner', async ({
    alice,
  }) => {
    const { page } = alice;
    const link = await alice.editor.copySectionLink('Milestones');
    await page.goto(homePathOf(page));
    await expect(page.getByTestId('workspace-switcher')).toContainText(
      'Section Links WS',
      {
        timeout: 30_000,
      },
    );

    await page.goto(link);

    const banner = page
      .getByRole('status')
      .filter({ hasText: 'Opened from a link to' });
    await expect(banner).toHaveText('Opened from a link to Milestones', {
      timeout: 30_000,
    });
    await expect
      .poll(() => offsetInScroller(page, 'Milestones'))
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => offsetInScroller(page, 'Milestones'))
      .toBeLessThan(120);
    await expect(alice.editor.block('Milestones')).toHaveClass(/section-wash/);
    await expect(alice.editor.block('Milestones')).not.toHaveClass(
      /section-wash/,
      {
        timeout: 5_000,
      },
    );

    await page.getByRole('button', { name: 'Go to top' }).click();
    await expect.poll(() => offsetInScroller(page, 'Intro')).toBeLessThan(120);
    await expect
      .poll(() => offsetInScroller(page, 'Intro'))
      .toBeGreaterThanOrEqual(0);

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });

  test('opens at the top with a banner when the section was removed', async ({
    alice,
  }) => {
    const { page } = alice;
    const link = await alice.editor.copySectionLink('Milestones');
    await alice.editor.openBlockMenu('Milestones');
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
    await expect.poll(() => offsetInScroller(page, 'Intro')).toBeLessThan(120);
    await expect
      .poll(() => offsetInScroller(page, 'Intro'))
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
