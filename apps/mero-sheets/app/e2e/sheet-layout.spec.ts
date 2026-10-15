/**
 * Layout guarantees of the sheet card:
 *
 *  - A rejected tab rename says why in a message nothing covers. The tab
 *    strip scrolls sideways, and a scroller clips both axes, so a message
 *    anchored inside a tab was cut off by the strip it floats above.
 *  - On a phone the grid scrolls sideways inside itself: the row numbers stay
 *    pinned at its left edge with their right rule (a collapsed table border
 *    used to scroll off with the cells), column A comes back on swiping back,
 *    and the page itself never scrolls sideways, not even by zooming in on a
 *    focused field.
 */
import { test, expect, type Page } from '@playwright/test';
import { openNewWorkbook, clearAuth, cell } from './helpers';

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

test.describe('Sheet card layout on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('the row numbers stay pinned, edge and all, while the grid swipes sideways, and column A comes back', async ({ page }) => {
    await openNewWorkbook(page, { name: 'Phone grid' });
    await expect(page.getByTestId('item-sheet')).toHaveCount(1);
    const grid = page.getByRole('grid', { name: 'Spreadsheet grid' });
    const rowHeader = page.getByLabel('Row 1', { exact: true });
    const gridBox = (await grid.boundingBox())!;
    const gutter = async () => {
      const rh = (await rowHeader.boundingBox())!;
      // The corner and the row numbers.
      return page.screenshot({ clip: { x: gridBox.x, y: gridBox.y, width: rh.x + rh.width - gridBox.x, height: 200 } });
    };
    // The gutter draws its own right rule, in its last pixel column: that
    // column differs from the plain gutter a few pixels in (clear of the row
    // numbers). A collapsed table border belongs to the table instead, and
    // scrolls away with the cells.
    const expectGutterEdge = async () => {
      const rh = (await rowHeader.boundingBox())!;
      const strip = (x: number) => page.screenshot({ clip: { x, y: gridBox.y, width: 1, height: 200 } });
      const edge = await strip(rh.x + rh.width - 1);
      const inside = await strip(rh.x + rh.width - 6);
      expect(edge.equals(inside), 'the row numbers keep their right rule').toBe(false);
    };
    const pageScroll = () => page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollX: window.scrollX,
    }));
    const swipe = async (dx: number) => {
      const cdp = await page.context().newCDPSession(page);
      const y = gridBox.y + 150;
      const from = dx < 0 ? gridBox.x + gridBox.width - 10 : gridBox.x + 70;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (dx * i) / 8, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
    const settledScroll = async () => {
      let last = -1;
      await expect.poll(async () => {
        const now = await grid.evaluate((el) => el.scrollLeft);
        const same = now === last;
        last = now;
        return same;
      }, { intervals: [150] }).toBe(true);
      return last;
    };

    const atRest = await gutter();
    await swipe(-280);
    expect(await settledScroll()).toBeGreaterThan(150);
    await expect(cell(page, 0, 0)).not.toBeInViewport({ ratio: 1 });
    const rh = (await rowHeader.boundingBox())!;
    expect(Math.abs(rh.x - gridBox.x)).toBeLessThanOrEqual(1);
    // The gutter is drawn the same as at rest: its edge moves with it instead
    // of scrolling off with the cells, so it still reads as a pinned column.
    expect((await gutter()).equals(atRest), 'the corner and row numbers are drawn as at rest').toBe(true);
    await expectGutterEdge();
    expect(await pageScroll()).toEqual({ overflow: 0, scrollX: 0 });

    // Swiping back brings column A back beside the row numbers.
    await expect(async () => {
      await swipe(280);
      expect(await settledScroll()).toBe(0);
    }).toPass();
    await expect(cell(page, 0, 0)).toBeInViewport({ ratio: 1 });
    const a1 = (await cell(page, 0, 0).boundingBox())!;
    expect(Math.abs(a1.x - (rh.x + rh.width))).toBeLessThanOrEqual(1);
    expect((await gutter()).equals(atRest), 'the corner and row numbers are drawn as at rest').toBe(true);
    expect(await pageScroll()).toEqual({ overflow: 0, scrollX: 0 });
  });

  test('text fields are at least 16px, so a phone does not zoom the page in on focus', async ({ page }) => {
    // iOS Safari zooms the page in when a field under 16px takes focus, and
    // does not zoom back out: the page then pans sideways and the row numbers
    // and column A slide out of view.
    await openNewWorkbook(page, { name: 'Phone zoom' });
    await cell(page, 0, 0).click();
    const fontSize = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await fontSize(page.getByLabel('Formula bar'))).toBeGreaterThanOrEqual(16);
    await page.getByTestId('item-sheet').first().dblclick();
    expect(await fontSize(page.getByLabel('Rename sheet'))).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
