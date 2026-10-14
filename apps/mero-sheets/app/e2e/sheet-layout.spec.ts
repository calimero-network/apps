/**
 * Layout guarantees of the sheet card:
 *
 *  - A rejected tab rename says why in a message nothing covers. The tab
 *    strip scrolls sideways, and a scroller clips both axes, so a message
 *    anchored inside a tab was cut off by the strip it floats above.
 */
import { test, expect, type Page } from '@playwright/test';
import { openNewWorkbook, clearAuth } from './helpers';

/** Renames the first tab to the second tab's name, which the engine refuses. */
async function renameToDuplicate(page: Page) {
  await page.getByTestId('action-create_sheet').click();
  const tabs = page.getByTestId('item-sheet');
  await expect(tabs).toHaveCount(2);
  const taken = (await tabs.nth(1).innerText()).replace('×', '').trim();
  await tabs.first().dblclick();
  const input = page.getByLabel('Rename sheet');
  await input.fill(taken);
  await input.press('Enter');
  const error = page.getByRole('alert').filter({ hasText: /already exists/i });
  await expect(error).toBeVisible();
  return error;
}

/** The message lies wholly in the viewport and is what is drawn at its corners and centre. */
async function expectUncovered(page: Page, error: ReturnType<Page['getByRole']>) {
  const box = (await error.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  const hits = await error.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const inset = 3;
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
  });
  expect(hits).toEqual([true, true, true, true, true]);
  // And the strip is not drawn over it: the two do not overlap.
  const strip = (await page.getByRole('tablist', { name: 'Spreadsheet sheets' }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(strip.y);
}

test.describe('Sheet card layout', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  for (const { label, width, height, dark } of [
    { label: 'desktop, light', width: 1280, height: 800, dark: false },
    { label: 'desktop, dark', width: 1280, height: 800, dark: true },
    { label: 'phone, light', width: 390, height: 844, dark: false },
  ]) {
    test(`a rejected tab rename shows its whole message above the tab strip (${label})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openNewWorkbook(page, { name: 'Rename check' });
      if (dark) {
        await page.getByTestId('theme-toggle').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      }
      const error = await renameToDuplicate(page);
      await expectUncovered(page, error);
      // Fixing the draft clears it.
      await page.getByLabel('Rename sheet').fill('Unique name');
      await expect(error).toBeHidden();
    });
  }

});
