// Tags as a user meets them: added above a document's first line, counted in
// the sidebar and on Home, one tag's page, and deleting a tag.

import { test, expect } from '../fixtures/single-user';

const AMBER = 'rgb(245, 158, 11)';

test.describe('Tags (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Tags WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap');
    await alice.createFolder({ name: 'Design', visibility: 'Open' });
    await alice.tree.openFolder('Design');
    await alice.createDoc('Brand');
  });

  test('a new tag keeps its colour everywhere, and a differently cased name reuses it', async ({
    alice,
  }) => {
    const { page, tags, home } = alice;
    await alice.openDoc('Roadmap');
    await tags.create('launch', 'Amber');
    expect(await tags.dotColour('launch')).toBe(AMBER);
    await expect(home.tagRow('launch')).toHaveAccessibleName('launch, 1');

    await alice.openDoc('Brand');
    await tags.openAdd();
    await tags.input().fill('Launch');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveAccessibleName(/^launch\s*1 doc$/);
    await expect(page.getByRole('option', { name: /^Create tag/ })).toHaveCount(
      0,
    );
    await page.keyboard.press('Enter');
    await expect(tags.chip('launch')).toBeVisible({ timeout: 15_000 });
    expect(await tags.dotColour('launch')).toBe(AMBER);

    await expect(home.tagRow('launch')).toHaveAccessibleName('launch, 2', {
      timeout: 15_000,
    });
    await expect(
      page.locator('aside').getByRole('button', { name: /^launch,/i }),
    ).toHaveCount(1);
    await home.open();
    await expect(home.row('Brand')).toContainText('launch');
    await expect(home.row('Roadmap')).toContainText('launch');
  });

  test("a tag's page is Home filtered to it, and other filters still narrow it", async ({
    alice,
  }) => {
    const { page, tags, home } = alice;
    await alice.openDoc('Roadmap');
    await tags.create('q3');
    await alice.openDoc('Brand');
    await tags.add('q3');

    await home.tagRow('q3').click();
    await expect(page).toHaveURL(/\?tag=q3$/);
    await expect(home.heading()).toHaveText('q3');
    await expect(page.getByText('2 documents in 2 folders')).toBeVisible();
    await home.expectTitles(['Brand', 'Roadmap']);
    await expect(home.tagRow('q3')).toHaveAttribute('aria-current', 'page');

    await home.chip('Folder').click();
    await page.getByRole('checkbox', { name: /^Design/ }).click();
    await page.keyboard.press('Escape');
    await home.expectTitles(['Brand']);
    await expect(page).toHaveURL(/tag=q3/);
  });

  test('a tag made from the sidebar has no docs, so only Add tag offers it', async ({
    alice,
  }) => {
    const { page, tags, home } = alice;
    await page
      .locator('aside')
      .getByRole('button', { name: 'New tag' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'New tag' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Research');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await expect(home.heading()).toHaveText('Research');
    await expect(home.tagRow('Research')).toHaveCount(0);

    await alice.openDoc('Roadmap');
    await tags.add('res', 'Research');
    await expect(home.tagRow('Research')).toHaveAccessibleName('Research, 1', {
      timeout: 15_000,
    });
  });

  test('deleting a tag asks first, then takes it off every doc and out of the sidebar', async ({
    alice,
  }) => {
    const { page, tags, home } = alice;
    await alice.openDoc('Roadmap');
    await tags.create('stale');
    await alice.openDoc('Brand');
    await tags.add('stale');

    await home.tagRow('stale').click();
    await page.getByRole('main').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Delete tag' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete tag?' });
    await expect(confirm).toContainText('every document you can edit');
    await confirm.getByRole('button', { name: 'Delete tag' }).click();

    await expect(home.heading()).toHaveText('Home', { timeout: 15_000 });
    await expect(page).not.toHaveURL(/tag=/);
    await expect(home.tagRow('stale')).toHaveCount(0);
    await expect(home.row('Brand')).not.toContainText('stale');
    await alice.openDoc('Roadmap');
    await expect(tags.chip('stale')).toHaveCount(0);
  });

  test('Add tag works from the keyboard, with named colour swatches', async ({
    alice,
  }) => {
    const { page, tags } = alice;
    await alice.openDoc('Roadmap');
    await tags.create('alpha');
    await alice.openDoc('Brand');

    await tags.row().getByRole('button', { name: 'Add tag' }).focus();
    await page.keyboard.press('Enter');
    await expect(tags.input()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tags.input()).toBeHidden();

    await tags.openAdd();
    await page.keyboard.type('beta');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Purple' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Green' })).toBeChecked();
    await tags.input().focus();
    await page.keyboard.press('Enter');
    await expect(tags.chip('beta')).toBeVisible({ timeout: 15_000 });
    expect(await tags.dotColour('beta')).toBe('rgb(16, 185, 129)');

    await tags.openAdd();
    await page.keyboard.press('Enter');
    await expect(tags.chip('alpha')).toBeVisible({ timeout: 15_000 });
  });
});
