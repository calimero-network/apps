/**
 * Keys typed right after clicking a cell go into that cell.
 *
 * A click moves keyboard focus to the formula bar, which owns typing. The
 * browser's own focus change on mouse-down used to land after that and park
 * focus on the grid, which ignores printable keys, until the next frame handed
 * it back. Whatever was typed in between was lost: a formula typed at speed
 * ended up as an empty cell. The next frame is held back here to show it on
 * any machine.
 */
import { test, expect } from '@playwright/test';
import { clearAuth, openNewWorkbook, cell } from './helpers';

test.describe('Typing right after a click', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('a formula typed before the next frame lands in the clicked cell', async ({ page }) => {
    await openNewWorkbook(page);
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });

    await cell(page, 2, 2).click();
    await page.keyboard.type('=1+2');
    await page.keyboard.press('Enter');

    await expect(cell(page, 2, 2)).toHaveText('3');
  });
});
