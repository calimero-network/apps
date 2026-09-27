// Home's filters live in the URL: each chip writes it, a pasted link shows the
// same list, and the sort survives a reload.

import { test, expect } from '../fixtures/single-user';

function searchOf(page: { url(): string }): string {
  return new URL(page.url()).search;
}

test.describe('Home filters (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Filters WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap');
    await alice.createFolder({ name: 'Design', visibility: 'Open' });
    await alice.tree.openFolder('Design');
    await alice.createDoc('Brand');
    await alice.home.open();
    await alice.home.expectTitles(['Brand', 'Roadmap']);
  });

  test('each chip writes the URL, and Clear empties it', async ({ alice }) => {
    const { page, home } = alice;

    await home.chip('Folder').click();
    await page.getByRole('checkbox', { name: /^Design/ }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/[?&]folder=/);
    await home.expectTitles(['Brand']);
    await expect(home.chip('Folder: Design')).toBeVisible();
    await expect(page.getByText('1 document matches')).toBeVisible();

    await home.chip('Updated').click();
    await page.getByRole('radio', { name: 'Today' }).click();
    await expect(
      page.getByRole('radiogroup', { name: 'Updated' }),
    ).toBeHidden();
    expect(searchOf(page)).toContain('updated=1d');
    await home.expectTitles(['Brand']);

    await home.chip('Created by').click();
    await page.getByRole('checkbox', { name: /^You/ }).click();
    await page.keyboard.press('Escape');
    expect(searchOf(page)).toContain('by=');
    await expect(home.chip('Created by: You')).toBeVisible();

    await home.chip('Archived').click();
    expect(searchOf(page)).toContain('archived=true');
    await expect(
      page.getByRole('heading', { name: 'No documents match these filters' }),
    ).toBeVisible();

    await home.chip('Clear').click();
    expect(searchOf(page)).toBe('');
    await home.expectTitles(['Brand', 'Roadmap']);
  });

  test('a pasted filter URL shows the same list in a fresh tab', async ({
    alice,
  }) => {
    const { page, home } = alice;
    await home.chip('Folder').click();
    await page.getByRole('checkbox', { name: /^Product/ }).click();
    await page.keyboard.press('Escape');
    await home.expectTitles(['Roadmap']);
    const url = page.url();

    const fresh = await page.context().newPage();
    await fresh.goto(url);
    await expect(fresh.getByRole('main').getByTestId('doc-title')).toHaveText(
      ['Roadmap'],
      {
        timeout: 30_000,
      },
    );
    await expect(
      fresh.getByRole('main').getByRole('button', { name: 'Folder: Product' }),
    ).toBeVisible();
    await fresh.close();
  });

  test('the sort cycles, stays in the URL and survives a reload', async ({
    alice,
  }) => {
    const { page, home } = alice;
    // Editing the older doc puts it first by last update, but not by name or creation.
    await home.row('Roadmap').click();
    await alice.editor.expectMounted();
    await alice.editor.type('edited');
    await home.open();
    await home.expectTitles(['Roadmap', 'Brand']);

    await home.chip('Sort: Last updated').click();
    expect(searchOf(page)).toBe('?sort=name');
    await home.expectTitles(['Brand', 'Roadmap']);

    await home.chip('Sort: Name').click();
    expect(searchOf(page)).toBe('?sort=created');
    await home.expectTitles(['Brand', 'Roadmap']);

    await page.reload();
    await expect(home.chip('Sort: Created')).toBeVisible({ timeout: 30_000 });
    await home.expectTitles(['Brand', 'Roadmap']);
  });

  test('a messy URL is rewritten to its canonical form', async ({ alice }) => {
    const { page } = alice;
    const url = new URL(page.url());
    url.search = '?sort=bogus&junk=1&updated=never';
    await page.goto(url.toString());
    await expect(page.getByRole('main').getByTestId('doc-title')).toHaveText(
      ['Brand', 'Roadmap'],
      { timeout: 30_000 },
    );
    await expect.poll(() => searchOf(page)).toBe('');
  });
});
