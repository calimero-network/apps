// Mentioning a member with @: the People group, the person chip and its card,
// then the docs that mention you on Home, in the sidebar and in the palette.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';

const MEMBER_PATH = /\/app\/[^/]+\/m\/[0-9a-f]{64}$/; // a mention's href

async function saved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Mentions (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Mentions WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Notes');
    await alice.createDoc('Plan');
    await alice.openDoc('Plan');
    await alice.editor.type('Ask ');
  });

  test('@ lists People then Documents, and mentioning yourself inserts a person chip', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await page.keyboard.type('@');
    const picker = editor.linkPicker();
    await expect(picker.getByRole('group')).toHaveCount(2);
    await expect(picker.getByRole('group').first()).toHaveAttribute(
      'aria-label',
      'People',
    );
    await expect(editor.personOption('You')).toBeVisible();
    await expect(
      picker.getByRole('group', { name: 'Documents' }).getByRole('option', {
        name: /Notes/,
      }),
    ).toBeVisible();

    await page.keyboard.type('ali');
    await editor.personOption('You').click();
    const chip = editor.mentionChip('@alice');
    await expect(chip).toHaveAttribute('href', MEMBER_PATH);
    await expect(chip).toHaveCSS('border-radius', '999px');
    await expect(editor.block('Ask')).toHaveText('Ask @alice');
    await saved(page);

    const url = page.url();
    await chip.hover();
    await expect(editor.memberCard()).toContainText('You');
    await expect(editor.memberCard()).toContainText('Can open this folder');
    await page.mouse.move(0, 0);
    await expect(editor.memberCard()).toBeHidden({ timeout: 5_000 });

    await chip.click();
    await expect(editor.memberCard()).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test('Mentioned me lists the doc on Home, in the sidebar and in the palette', async ({
    alice,
  }) => {
    const { page, editor, home } = alice;
    await editor.mention('ali', 'You');
    await saved(page);
    await editor.close();

    await home.open();
    await expect(home.mentionsRow()).toHaveAccessibleName('Mentions, 1', {
      timeout: 30_000,
    });
    await home.mentionsRow().click();
    await expect(page).toHaveURL(/[?&]mentions=me(&|$)/);
    await home.expectTitles(['Plan']);
    await expect(home.mentionsRow()).toHaveAttribute('aria-current', 'page');

    await home.chip('Mentioned me').click();
    await expect(page).not.toHaveURL(/mentions=/);
    await home.expectTitles(['Plan', 'Notes']);

    await home.chip('Mentioned me').click();
    await home.saveViewButton().click();
    await expect(page.getByText('Mentioned me').last()).toBeVisible();
    await page.keyboard.press('Escape');

    await page
      .getByRole('button', { name: 'Search docs, folders and tags' })
      .click();
    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(
      palette.getByText('Type @me for documents that mention you'),
    ).toBeVisible();
    await palette.getByRole('textbox', { name: 'Search' }).fill('@me');
    const mentions = palette.getByRole('group', { name: 'Mentions of you' });
    await expect(mentions.getByRole('option')).toHaveCount(1);
    await expect(mentions.getByRole('option')).toContainText('Ask @alice');
    await page.keyboard.press('Enter');
    await editor.expectMounted();
    await expect(page.getByTestId('doc-title-input')).toHaveValue('Plan');
  });
});
