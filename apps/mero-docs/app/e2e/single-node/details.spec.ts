// The Details panel beside a document: its facts, the links in and out, the
// remembered open state, and the sheet it becomes on a phone.

import { test, expect } from '../fixtures/single-user';
import { settled } from '../fixtures/workspace';

const PHONE = { width: 375, height: 667 };

test.describe('Details panel (single-node)', () => {
  let pricingUrl = '';

  test.beforeEach(async ({ alice }) => {
    const { page, editor } = alice;
    await alice.goToWorkspace();
    await alice.createNamespace(`Details WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Pricing notes');
    await alice.createDoc('Launch plan');

    await alice.openDoc('Pricing notes');
    pricingUrl = page.url();
    await editor.close();

    await alice.openDoc('Launch plan');
    await alice.tags.create('q3');
    await editor.type('Intro');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Milestones');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Costs follow ');
    await editor.pasteLink(pricingUrl, 'Pricing notes');
    await page.keyboard.type(' for now.');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('lists the folder, authors, tags and the links out and in (L-23)', async ({
    alice,
  }) => {
    const { page, details, editor } = alice;
    await details.open();

    await expect(details.fact('Folder')).toHaveText('Product');
    await expect(details.fact('Created')).toHaveText(/ by You$/);
    await expect(details.fact('Updated')).toHaveText(/ by You$/);
    await expect(details.fact('Tags')).toHaveText('q3');

    const out = details.section('Links to');
    await expect(out.getByRole('button')).toHaveCount(1, { timeout: 30_000 });
    await expect(out.getByRole('button')).toContainText('Pricing notes');
    await expect(out.getByRole('button')).toContainText(
      'Linked in “Milestones”',
    );
    await expect(details.section('Linked from')).toContainText(
      'No documents link here yet',
    );
    await expect(details.panel()).toContainText(
      'Only documents you can open are listed',
    );

    await out.getByRole('button', { name: /Pricing notes/ }).click();
    await editor.expectMounted();
    await expect(page.getByTestId('doc-title-input')).toHaveValue(
      'Pricing notes',
    );
    const from = details.section('Linked from');
    await expect(from.getByRole('button')).toHaveCount(1, { timeout: 30_000 });
    await expect(from.getByRole('button')).toContainText('Launch plan');
    await expect(from.locator('b')).toHaveText('Pricing notes');
  });

  test('stays open or closed on this device across reloads', async ({
    alice,
  }) => {
    const { page, details, editor } = alice;
    await details.open();
    await expect(details.toggle()).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await editor.expectMounted();
    await expect(details.panel()).toBeVisible();

    await details
      .panel()
      .getByRole('button', { name: 'Close details' })
      .click();
    await expect(details.panel()).toBeHidden();
    await page.reload();
    await editor.expectMounted();
    await expect(details.toggle()).toHaveAttribute('aria-pressed', 'false');
    await expect(details.panel()).toBeHidden();
  });

  test('opens as a sheet on a phone that Esc and the backdrop close (L-27)', async ({
    alice,
  }) => {
    const { page, details } = alice;
    await page.setViewportSize(PHONE);
    const sheet = page.getByRole('dialog', { name: 'Details' });

    await details.toggle().click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await details.toggle().click();
    await expect(sheet).toBeVisible();
    await settled(sheet);
    await page.mouse.click(10, PHONE.height / 2);
    await expect(sheet).toBeHidden();
  });
});
