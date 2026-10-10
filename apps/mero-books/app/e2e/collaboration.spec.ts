// Two members keeping one set of books on two nodes: an invoice approved on
// one node shows on the other's sales list, a payment recorded there settles
// it, and the first node sees it paid.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createInvoice, uniqueName } from './helpers';

test.describe('collaboration: one organisation, two nodes', () => {
  test('an invoice and its payment replicate between teammates', async ({ browser }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    try {
      await loginViaHash(a, 0);
      await createWorkspace(a);
      await loginViaHash(b, 1);
      await createWorkspace(b);

      const customer = uniqueName('Shared customer');
      await createInvoice(a, { contact: customer, description: 'Retainer', price: '500', approve: true });
      const number = (await a.getByTestId('invoice-number').textContent())?.trim() ?? '';
      expect(number).toMatch(/^INV-\d{4}$/);

      await b.getByTestId('nav-sales').click();
      const onB = b.getByTestId('doc-row').filter({ hasText: customer });
      await expect(onB).toBeVisible({ timeout: 45_000 });
      await expect(onB.getByTestId('doc-number')).toHaveText(number);

      await onB.click();
      await b.getByTestId('record-payment').click();
      await b.getByTestId('payment-save').click();
      await expect(b.getByTestId('doc-status')).toHaveAttribute('data-status', 'paid', { timeout: 20_000 });

      await a.reload();
      await expect(a.getByTestId('doc-status')).toHaveAttribute('data-status', 'paid', { timeout: 45_000 });
    } finally {
      await clearAuth(a).catch(() => {});
      await clearAuth(b).catch(() => {});
    }
  });
});
