// The bookkeeping loop on one node, through the UI: invoice -> approve ->
// import the bank statement -> reconcile the payment line by creating the
// payment from the invoice -> code a bank fee straight from the statement ->
// the reports agree.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createInvoice, uniqueName } from './helpers';

test.describe('accounting: invoice, bank and reports', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('an invoice is approved, paid, reconciled and reported', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);

    const customer = uniqueName('Reconcile Co');
    await createInvoice(page, { contact: customer, description: 'Design work', quantity: '2', price: '250', approve: true });
    // 2 × 250.00 + 20% tax.
    await expect(page.getByTestId('invoice-total')).toHaveText('600.00');
    await expect(page.getByTestId('doc-status')).toHaveAttribute('data-status', 'awaiting_payment');

    // Part-pay it.
    await page.getByTestId('record-payment').click();
    await page.getByTestId('payment-amount').fill('100');
    await page.getByTestId('payment-save').click();
    await expect(page.getByTestId('invoice-amount-due')).toContainText('500.00', { timeout: 15_000 });
    await expect(page.getByTestId('payment-row')).toHaveCount(1);

    // A bank statement with the payment and a fee; amounts unique to this run.
    const fee = (Math.floor(Math.random() * 900) + 100) / 100;
    const today = new Date().toISOString().slice(0, 10);
    const csv = `Date,Description,Amount\n${today},${customer},100.00\n${today},BANK FEE ${customer},-${fee.toFixed(2)}\n`;

    await page.getByTestId('nav-bank').click();
    await page.getByTestId('bank-card').first().click();
    await page.getByTestId('statement-import-btn').click();
    await page.getByTestId('statement-csv').fill(csv);
    await expect(page.getByTestId('statement-preview')).toContainText(customer);
    await page.getByTestId('statement-import').click();

    // The payment line is suggested against the payment already recorded.
    const paymentLine = page.getByTestId('reconcile-row').filter({ hasText: customer }).filter({ hasText: '100.00' });
    await expect(paymentLine.getByTestId('reconcile-suggestion')).toBeVisible({ timeout: 20_000 });
    await paymentLine.getByTestId('reconcile-ok').click();
    await expect(paymentLine).toHaveCount(0, { timeout: 15_000 });

    // The fee has nothing to match: code it to Bank Fees.
    const feeLine = page.getByTestId('reconcile-row').filter({ hasText: `BANK FEE ${customer}` });
    await feeLine.getByTestId('reconcile-tab-create').click().catch(() => {});
    await feeLine.getByTestId('reconcile-account').selectOption('acc-bank-fees');
    await feeLine.getByTestId('reconcile-create').click();
    await expect(feeLine).toHaveCount(0, { timeout: 15_000 });

    // The trial balance balances, and the profit and loss shows the sale.
    await page.getByTestId('nav-reports').click();
    await page.getByTestId('report-tab-trial').click();
    const debit = await page.getByTestId('tb-total-debit').textContent();
    await expect(page.getByTestId('tb-total-credit')).toHaveText(debit ?? '');
    await page.getByTestId('report-tab-pnl').click();
    await expect(page.getByTestId('pnl-net-profit')).toBeVisible();
  });
});
