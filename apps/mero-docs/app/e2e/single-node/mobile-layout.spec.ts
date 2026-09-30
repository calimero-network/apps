// Below md the folder sidebar is a drawer opened from the top bar, and the
// shell and its dialogs fit a 375x667 phone screen.

import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import { settled } from '../fixtures/workspace';

const PHONE = { width: 375, height: 667 };

async function expectInsideViewport(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(PHONE.width);
}

test.describe('Mobile layout (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.page.setViewportSize(PHONE);
    await alice.goToWorkspace();
    await alice.createNamespace(`Mobile WS ${Date.now()}`);
  });

  test('the sidebar is a drawer that closes after choosing a folder', async ({
    alice,
  }) => {
    const { page } = alice;
    const drawer = page.getByRole('dialog', { name: 'Folders' });
    await expect(drawer).toBeHidden();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: /^New( folder)?$/ }).click();
    const newFolder = page.getByRole('dialog', { name: 'New folder' });
    await expect(newFolder).toBeVisible();
    await expectInsideViewport(newFolder);
    await newFolder.getByPlaceholder(/Folder name/i).fill('Phone notes');
    await newFolder.getByRole('button', { name: /^Create$/ }).click();
    await expect(newFolder).toBeHidden({ timeout: 15_000 });

    await drawer
      .locator('li > div')
      .filter({ hasText: /^\s*Phone notes\s*$/ })
      .first()
      .click();
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole('main').getByRole('button', { name: /^New document$/ }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Escape and the backdrop close the drawer', async ({ alice }) => {
    const { page } = alice;
    const drawer = page.getByRole('dialog', { name: 'Folders' });
    const toggle = page.getByRole('button', { name: 'Show sidebar' });

    await toggle.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(drawer).toBeVisible();
    await settled(drawer);
    await page.mouse.click(PHONE.width - 10, PHONE.height / 2);
    await expect(drawer).toBeHidden();
  });

  test('workspace settings fit without horizontal scroll', async ({
    alice,
  }) => {
    await alice.openSettings();
    await expectNoHorizontalScroll(alice.page);
  });
});
