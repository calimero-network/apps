// My Issues coverage: assignments store the display string the assignee
// picker writes (an alias, mirroring the field-assignee datalist), so the
// `?assignee=me` filter must resolve the current identity through the same
// alias map to match - not compare against the raw public key.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createIssue, uniqueName, openAliasModal } from './helpers';

test.describe('my issues: assignee filter matches on the alias assignments actually store', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('an issue self-assigned via the alias-populated field appears in My Issues; a foreign-assigned one does not', async ({ page }) => {
    const alias = `myself-${Date.now().toString(36)}`;

    // Set an alias for the current identity via the UI (the Members "set your
    // alias" flow - same as aliases.spec.ts).
    await page.getByTestId('nav-members').click();
    const aliasInput = await openAliasModal(page);
    await aliasInput.fill(alias);
    await page.getByTestId('alias-save-btn').click();
    await expect(aliasInput).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(alias, { timeout: 10_000 });

    await page.getByRole('link', { name: /All Issues/ }).click();

    // Issue 1: assign to self using the alias - the value the datalist offers
    // for the current identity, and what the picker actually writes.
    const titleMine = uniqueName('mine');
    await createIssue(page, { title: titleMine });
    const cardMine = page.getByTestId('item-issue').filter({ hasText: titleMine });
    await expect(cardMine).toBeVisible({ timeout: 10_000 });
    await cardMine.click();
    await page.getByTestId('field-assignee').fill(alias);
    await page.getByTestId('action-set_assignee').click();
    await page.getByTestId('action-back').click();

    // Issue 2: assigned to an unrelated teammate name - must never show up
    // under My Issues for this identity.
    const titleForeign = uniqueName('foreign');
    const foreignAssignee = uniqueName('teammate');
    await createIssue(page, { title: titleForeign });
    const cardForeign = page.getByTestId('item-issue').filter({ hasText: titleForeign });
    await expect(cardForeign).toBeVisible({ timeout: 10_000 });
    await cardForeign.click();
    await page.getByTestId('field-assignee').fill(foreignAssignee);
    await page.getByTestId('action-set_assignee').click();
    await page.getByTestId('action-back').click();

    await page.getByTestId('nav-my-issues').click();
    await expect(page.getByTestId('item-issue').filter({ hasText: titleMine })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('item-issue').filter({ hasText: titleForeign })).toHaveCount(0);
  });
});
