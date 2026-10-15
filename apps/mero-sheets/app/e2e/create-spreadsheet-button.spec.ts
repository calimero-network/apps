/**
 * "Create spreadsheet" is pressable once, and then stays pressable.
 *
 * The picker learns what is on the node in three reads, one after another:
 * this app's id, then its namespace, then the spreadsheets in it. The button
 * used to be disabled while ANY of them was in flight, and each read only
 * reports itself in flight from the render after it is asked for, so between
 * reads the button came on for a frame and went off again. A press in one of
 * those frames hit a disabled button and did nothing: no spreadsheet, no
 * error, the picker still showing. That is how `openNewWorkbook` timed out in
 * CI, waiting a minute for a grid that was never asked for. A slow node or a
 * busy machine widens the gaps; the node reads here are slowed to show it on
 * any machine.
 */
import { test, expect } from '@playwright/test';
import { chooseNickname, clearAuth, loginViaHash, openNewWorkbook, cell } from './helpers';

/** Every state the button is drawn in, in order, from its first appearance. */
async function recordButtonStates(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const states: boolean[] = [];
    (window as unknown as { __createStates: boolean[] }).__createStates = states;
    const seen = () => {
      const b = document.querySelector<HTMLButtonElement>('[data-testid="action-init_project"]');
      if (b && states[states.length - 1] !== b.disabled) states.push(b.disabled);
    };
    new MutationObserver(seen).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
  });
}

test.describe('Creating a spreadsheet from the picker', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('the button, once it can be pressed, is not taken away while the list loads', async ({ page, browser }) => {
    // The node already has this app's namespace, which is the case where the
    // picker reads it and then the spreadsheets in it.
    const first = await browser.newContext();
    try {
      await openNewWorkbook(await first.newPage(), { name: 'Already here' });
    } finally {
      await first.close();
    }

    await page.route('**/admin-api/**', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });
    await recordButtonStates(page);
    await loginViaHash(page, 0);

    const create = page.getByTestId('action-init_project');
    await expect(create).toBeEnabled();
    // Every read has answered: the list is drawn.
    await expect(page.getByTestId('workspace-item').first()).toBeVisible();

    const states = await page.evaluate(
      () => (window as unknown as { __createStates: boolean[] }).__createStates,
    );
    // Off while the node is asked, then on: never on, off, on again.
    expect(states.indexOf(false)).toBeGreaterThanOrEqual(0);
    expect(states.slice(states.indexOf(false))).toEqual([false]);

    // And pressing it makes the spreadsheet.
    await page.getByTestId('field-name').fill('Pressed once');
    await create.click();
    await chooseNickname(page, 'Owner');
    await expect(cell(page, 0, 0)).toBeVisible({ timeout: 60_000 });
  });
});
