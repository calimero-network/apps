/**
 * The glass frame must never trap what floats over it. A `backdrop-filter`,
 * `filter` or `transform` on an ancestor turns it into the containing block
 * for `position: fixed` children, so a dialog's backdrop would cover only that
 * box. These check the backdrops still cover the whole viewport, and that a
 * phone gets no sideways scroll.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginViaHash, openNewWorkbook, clearAuth, chooseNickname, cell } from './helpers';

/** The dialog's fixed backdrop: its closest `position: fixed` ancestor. */
async function backdropBox(dialog: Locator) {
  return dialog.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node && getComputedStyle(node).position !== 'fixed') node = node.parentElement;
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

async function expectCoversViewport(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  const box = await backdropBox(dialog);
  const vp = page.viewportSize()!;
  expect(box).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Glass layout', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('dialogs and side sheets over a spreadsheet cover the whole viewport', async ({ page }) => {
    await openNewWorkbook(page, { name: 'Layout check' });

    await page.getByLabel('Invite collaborators').click();
    await expectCoversViewport(page, page.getByTestId('invite-link'));
    await page.keyboard.press('Escape');

    await page.getByLabel('Open function reference').click();
    await expectCoversViewport(page, page.getByRole('dialog', { name: 'Function reference' }));
    await page.getByRole('button', { name: 'Close function help' }).click();

    await page.getByLabel('Open comments').click();
    await expectCoversViewport(page, page.getByRole('dialog', { name: 'Comments' }));
    await page.getByRole('button', { name: 'Close comments' }).click();
  });

  test('a phone gets the whole app without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaHash(page, 0);
    await expectNoSideScroll(page);
    await page.getByTestId('field-name').fill('Phone check');
    await page.getByTestId('action-init_project').click();
    await chooseNickname(page, 'Phone');
    await cell(page, 0, 0).waitFor({ timeout: 60_000 });
    await expectNoSideScroll(page);
    for (const name of ['Back to spreadsheets', 'Invite collaborators', 'Log out']) {
      const box = await page.getByRole('button', { name }).first().boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    }
    await expect(page.getByTestId('theme-toggle')).toBeInViewport();
  });
});
