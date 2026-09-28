// Links between documents: the @ picker, a pasted app URL, clicking a link
// and the card shown on hover, including a link whose document was deleted.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';

const EXCERPT = 'Seat-based pricing does not fit a peer-to-peer product.';

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

async function saved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Doc links (single-node)', () => {
  let pricingPath = '';
  let planPath = '';

  test.beforeEach(async ({ alice }) => {
    const { page, editor } = alice;
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await alice.goToWorkspace();
    await alice.createNamespace(`Doc Links WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Pricing notes');
    await alice.createDoc('Launch plan');
    await alice.openDoc('Pricing notes');
    pricingPath = pathOf(page);
    await editor.type(EXCERPT);
    await saved(page);
    await editor.close();
    await alice.openDoc('Launch plan');
    planPath = pathOf(page);
    await editor.type('Pricing follows the model in ');
  });

  test('@ opens the picker and a pick inserts a chip (L-11, L-12)', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await page.keyboard.type('@');
    await expect(page.getByText('Link to a document')).toBeVisible();
    await page.keyboard.type('pric');
    await expect(editor.linkPicker().getByRole('option').first()).toContainText(
      'Pricing notes',
    );
    await page.keyboard.press('Enter');

    await expect(editor.linkPicker()).toBeHidden();
    await expect(editor.docLink('Pricing notes')).toHaveAttribute(
      'href',
      pricingPath,
    );
    await expect(editor.block('Pricing follows')).toHaveText(
      'Pricing follows the model in Pricing notes',
    );
  });

  test('Esc or typing past the picker leaves the text (L-14)', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await page.keyboard.type('@pr');
    await expect(editor.linkPicker()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Link to a document')).toBeHidden();
    await editor.expectContent('Pricing follows the model in @pr');

    await page.keyboard.type(' and @zzzzzz');
    await expect(page.getByText('Link to a document')).toBeHidden();
    await editor.expectContent('@pr and @zzzzzz');
    await expect(editor.docLink('Pricing notes')).toHaveCount(0);
  });

  test('an email address and [[ stay plain text', async ({ alice }) => {
    const { page, editor } = alice;
    await page.keyboard.type('ada@example.com or [[pr');
    await expect(page.getByText('Link to a document')).toBeHidden();
    await editor.expectContent('ada@example.com or [[pr');
  });

  test('the / menu keeps its blocks and links a document', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await page.keyboard.type('/');
    const menu = editor.slashMenu();
    await expect(
      menu.getByRole('option', { name: /Bullet list/ }),
    ).toBeVisible();
    await expect(
      menu.getByRole('option', { name: /Heading 1/ }).locator('kbd'),
    ).toHaveText(/^(⌘⌥1|Ctrl Alt 1)$/);

    await page.keyboard.type('mention');
    await expect(menu.getByRole('option')).toHaveText(['Link to a document']);
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(editor.linkPicker()).toBeVisible();
    await expect(editor.block('Pricing follows')).toHaveText(
      /^Pricing follows the model in\s*$/,
    );

    await page.keyboard.type('pric');
    await expect(editor.linkPicker().getByRole('option').first()).toContainText(
      'Pricing notes',
    );
    await page.keyboard.press('Enter');
    await expect(editor.docLink('Pricing notes')).toHaveAttribute(
      'href',
      pricingPath,
    );
    await expect(editor.block('Pricing follows')).toHaveText(
      'Pricing follows the model in Pricing notes',
    );
  });

  test('the / menu links a section of a document', async ({ alice }) => {
    const { page, editor } = alice;
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Rollout');
    await page.keyboard.press('Enter');
    await saved(page);

    // The heading reaches the text index a moment after the save.
    await expect(async () => {
      await page.keyboard.type('/section');
      await page.keyboard.press('Enter');
      await expect(
        editor.sectionPicker().getByRole('option', { name: /Rollout/ }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press('Enter');

    const link = page.locator(".bn-editor a[href*='#b=']", {
      hasText: 'Rollout',
    });
    await expect(link).toHaveAttribute('href', new RegExp(`^${planPath}#b=.+`));
    await expect(page.locator('.bn-editor')).not.toContainText('/section');
  });

  test('a pasted doc URL becomes a chip with the doc title (L-15)', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    const url = new URL(pricingPath, page.url()).toString();
    await page.evaluate((text) => navigator.clipboard.writeText(text), url);
    await page.keyboard.press('ControlOrMeta+v');

    await expect(editor.docLink('Pricing notes')).toHaveAttribute(
      'href',
      pricingPath,
    );

    await page.evaluate(() =>
      navigator.clipboard.writeText('https://example.com/pricing'),
    );
    await page.keyboard.press('ControlOrMeta+v');
    await editor.expectContent('https://example.com/pricing');
    await expect(page.locator(".bn-editor a[href^='/app/']")).toHaveCount(1);
  });

  test('a chip opens in the app; Cmd/Ctrl-click opens a new tab (L-16)', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await editor.linkDoc('pric', /Pricing notes/);
    await saved(page);

    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      editor.docLink('Pricing notes').click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await expect(tab).toHaveURL(new RegExp(`${pricingPath}(\\?|$)`));
    await tab.close();
    expect(pathOf(page)).toBe(planPath);

    await editor.docLink('Pricing notes').click();
    await expect.poll(() => pathOf(page)).toBe(pricingPath);
    await expect(page.getByTestId('doc-title-input')).toHaveValue(
      'Pricing notes',
    );
    expect(page.context().pages()).toHaveLength(1);
  });

  test('an external link still opens in a new tab (L-17)', async ({
    alice,
  }) => {
    const { page } = alice;
    await page.evaluate(() =>
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob(
            ['<a href="https://example.com/">Example</a>'],
            {
              type: 'text/html',
            },
          ),
          'text/plain': new Blob(['Example'], { type: 'text/plain' }),
        }),
      ]),
    );
    await page.keyboard.press('ControlOrMeta+v');
    const link = page.locator(".bn-editor a[href='https://example.com/']");
    await expect(link).toHaveText('Example');
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    const [linkColor, inkColor] = await link.evaluate((el) => {
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = 'hsl(var(--primary-ink))';
      const ink = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(el).color, ink];
    });
    expect(linkColor).toBe(inkColor);

    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      link.click(),
    ]);
    expect(tab.url()).toMatch(/^https:\/\/example\.com\/|^about:blank/);
    await tab.close();
    expect(pathOf(page)).toBe(planPath);
  });

  test('hovering a chip shows its card (L-18)', async ({ alice }) => {
    const { page, editor } = alice;
    await editor.linkDoc('pric', /Pricing notes/);

    await editor.docLink('Pricing notes').hover();
    const card = editor.linkCard();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Pricing notes');
    await expect(card).toContainText(/Product · updated .+ by You/);
    await expect(card.getByTestId('doc-link-card-excerpt')).toHaveText(
      EXCERPT,
      { timeout: 30_000 },
    );

    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
    await editor.docLink('Pricing notes').hover();
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
  });

  test('a link to a deleted doc says so, and lands on the deleted card (L-20)', async ({
    alice,
  }) => {
    const { page, editor } = alice;
    await editor.linkDoc('pric', /Pricing notes/);
    await saved(page);
    await editor.close();
    await alice.openDoc('Pricing notes');
    await editor.deleteDocument();
    await alice.openDoc('Launch plan');

    await editor.docLink('Pricing notes').hover();
    await expect(editor.linkCard()).toHaveText('This document was deleted', {
      timeout: 30_000,
    });

    await editor.docLink('Pricing notes').click();
    await expect.poll(() => pathOf(page)).toBe(pricingPath);
    await expect(
      page.getByText('This document was deleted or moved'),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
});
