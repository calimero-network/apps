// Two members of one sales team on two nodes: a deal added on one node shows on
// the other's board, and a stage move made there replicates back.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createDeal, uniqueName } from './helpers';

test.describe('collaboration: one pipeline, two nodes', () => {
  test('a deal and its stage move replicate between teammates', async ({ browser }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    try {
      await loginViaHash(a, 0);
      await createWorkspace(a);
      await loginViaHash(b, 1);
      await createWorkspace(b);

      const title = uniqueName('shared deal');
      await createDeal(a, { title, value: '30k' });

      const onB = b.getByTestId('deal-card').filter({ hasText: title });
      await expect(onB).toBeVisible({ timeout: 45_000 });

      await onB.click();
      await b.locator('[data-testid="stage-step"][data-stage-id="stage-meeting"]').click();

      const column = a.locator('[data-testid="stage-column"][data-stage-id="stage-meeting"]');
      await expect(column.getByTestId('deal-card').filter({ hasText: title })).toBeVisible({ timeout: 45_000 });
    } finally {
      await clearAuth(a).catch(() => {});
      await clearAuth(b).catch(() => {});
    }
  });
});
