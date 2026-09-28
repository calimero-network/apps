// The search palette: the top-bar field and Cmd/Ctrl+K, recent docs, title,
// folder and tag matches, matches inside doc text, and what it could not search.

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

const FIELD = 'Search docs, folders and tags'; // the top-bar field's accessible name
const TEXT_GROUP = 'In document text';
const SLOW_READ_MS = 5_000; // holds one doc read so the text search is caught mid-build

function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Search' });
}

function queryInput(page: Page) {
  return palette(page).getByRole('textbox', { name: 'Search' });
}

function group(page: Page, name: string) {
  return palette(page).getByRole('group', { name });
}

async function search(page: Page, text: string) {
  if (!(await palette(page).isVisible())) {
    await page.getByRole('button', { name: FIELD }).click();
  }
  await queryInput(page).fill(text);
}

// The editor's tag row: "Add tag", then create the tag by name.
async function tagOpenDoc(alice: WorkspaceDriver, name: string) {
  const main = alice.page.getByRole('main');
  await main.getByRole('button', { name: 'Add tag' }).click();
  await alice.page.getByRole('combobox', { name: 'Tag name' }).fill(name);
  await alice.page
    .getByRole('option', { name: `Create tag “${name}”` })
    .click();
  await expect(main.getByText(name, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** The JSON-RPC method and payload of a request to the node, if it is one. */
function rpcCall(route: Route): { method: string; args: unknown } | null {
  try {
    const body = JSON.parse(route.request().postData() ?? '');
    return body?.method === 'execute'
      ? { method: body.params?.method, args: body.params?.argsJson }
      : null;
  } catch {
    return null;
  }
}

test.describe('Search (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Search WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap 2026');
    await alice.createDoc('Q3 launch plan');
    await alice.createFolder({ name: 'Roads', visibility: 'Open' });
  });

  test('opens from the field, Cmd+K or Ctrl+K, and Esc gives focus back (S-01)', async ({
    alice,
  }) => {
    const { page } = alice;
    const field = page.getByRole('button', { name: FIELD });
    await field.click();
    await expect(queryInput(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(field).toBeFocused();

    await page.keyboard.press('ControlOrMeta+k');
    await expect(queryInput(page)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette(page)).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(queryInput(page)).toBeFocused();
  });

  test('lists recent docs newest first, then the tags tip (S-02)', async ({
    alice,
  }) => {
    await alice.home.open();
    await alice.home.row('Roadmap 2026').click();
    await alice.editor.expectMounted();
    await alice.home.open();
    await alice.home.row('Q3 launch plan').click();
    await alice.editor.expectMounted();

    await alice.page.getByRole('button', { name: FIELD }).click();
    await expect(group(alice.page, 'Recent').getByRole('option')).toHaveText([
      /^Q3 launch planProduct · opened just now/,
      /^Roadmap 2026Product · opened just now/,
    ]);
    await expect(group(alice.page, 'Tips')).toContainText(
      'Type # to search tags only',
    );
  });

  test('ranks title matches, then folders, highlighting the match (S-04)', async ({
    alice,
  }) => {
    const { page } = alice;
    await search(page, 'road');
    const docs = group(page, 'Documents').getByRole('option');
    await expect(docs).toHaveText([/^Roadmap 2026/]);
    await expect(docs.first().locator('mark')).toHaveText('Road');
    await expect(group(page, 'Folders').getByRole('option')).toHaveText([
      'Roads',
    ]);
    await search(page, 'zebra');
    await expect(
      palette(page).getByText('No documents, folders or tags match'),
    ).toBeVisible();
  });

  test('# searches tags only, and a tag opens Home filtered to it (S-09, S-11)', async ({
    alice,
  }) => {
    const { page } = alice;
    await alice.openDoc('Roadmap 2026');
    await tagOpenDoc(alice, 'roadmap');
    await alice.editor.close();

    await search(page, '#');
    await expect(palette(page).getByRole('group')).toHaveCount(1);
    await expect(group(page, 'Tags').getByRole('option')).toHaveText([
      '#roadmap1 document · show them all on Home',
    ]);
    await search(page, '#road');
    await expect(group(page, 'Documents')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(/\/app\/[^/?]+\?(.*&)?tag=/);
    await alice.home.expectTitles(['Roadmap 2026']);
  });

  test('arrows wrap, Enter opens, Cmd/Ctrl+Enter opens a new tab (S-10)', async ({
    alice,
  }) => {
    const { page } = alice;
    // "p": Q3 launch plan (word start), Roadmap 2026 (inside), then the Product folder.
    await search(page, 'p');
    const active = palette(page).getByRole('option', { selected: true });
    await expect(active).toContainText('Q3 launch plan');
    await page.keyboard.press('ArrowUp');
    await expect(active).toHaveText('Product');
    await page.keyboard.press('ArrowDown');
    await expect(active).toContainText('Q3 launch plan');

    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      page.keyboard.press('ControlOrMeta+Enter'),
    ]);
    await expect(tab).toHaveURL(/\/f\/[^/]+\/d\/[^/?#]+/);
    await tab.close();
    await expect(palette(page)).toBeVisible();

    await page.keyboard.press('Enter');
    await alice.editor.expectMounted();
    await expect(page.getByTestId('doc-title-input')).toHaveValue(
      'Q3 launch plan',
    );
  });

  test('a folder result opens the folder list (S-12)', async ({ alice }) => {
    const { page } = alice;
    await search(page, 'roads');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/f\/[^/?#]+(\?.*)?$/);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Roads' }),
    ).toBeVisible();
  });

  test('finds body text under its heading and opens at the block (S-13)', async ({
    alice,
  }) => {
    const { page } = alice;
    await alice.openDoc('Roadmap 2026');
    await alice.editor.type('# Versioning');
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'One breaking change per year, so v2 has to wait.',
    );
    await alice.editor.close();

    await search(page, 'breaking change');
    const hit = group(page, TEXT_GROUP).getByRole('option');
    await expect(hit).toHaveCount(1, { timeout: 30_000 });
    await expect(hit).toContainText('Roadmap 2026');
    await expect(hit).toContainText('in “Versioning”');
    await expect(hit.locator('mark')).toHaveText('breaking change');
    await hit.click();
    await expect(page).toHaveURL(/\/d\/[^/?#]+.*#b=/);
    await alice.editor.expectMounted();
  });

  test('titles answer at once while the text search is still building (S-16)', async ({
    alice,
  }) => {
    const { page } = alice;
    await page.route('**/jsonrpc', async (route) => {
      if (rpcCall(route)?.method === 'get_document') {
        await new Promise((resolve) => setTimeout(resolve, SLOW_READ_MS));
      }
      await route.continue();
    });
    await page.reload();
    await search(page, 'road');
    await expect(group(page, 'Documents').getByRole('option')).toHaveText([
      /^Roadmap 2026/,
    ]);
    await expect(
      group(page, TEXT_GROUP).getByText(/\d of \d folders searched/),
    ).toBeVisible();
    await expect(palette(page).getByText(/folders searched/)).toBeHidden({
      timeout: 60_000,
    });
  });

  test('names a folder it could not read instead of skipping it (S-17)', async ({
    alice,
  }) => {
    const { page } = alice;
    await alice.createFolder({ name: 'Finance', visibility: 'Open' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Budget');

    // Every list read that answers with Budget is Finance's: fail those.
    await page.route('**/jsonrpc', async (route) => {
      if (rpcCall(route)?.method !== 'list_docs') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      const docs: { title?: string }[] = body?.result?.output ?? [];
      if (docs.some((d) => d.title === 'Budget')) {
        return route.fulfill({ status: 500, body: 'unavailable' });
      }
      return route.fulfill({ response });
    });
    await page.reload();
    await search(page, 'road');
    const warning = palette(page).getByText(
      /^Finance (could not be searched|is still syncing)/,
    );
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).not.toContainText('Product');
  });

  test('fits a 375 px screen as an icon and a full-width sheet (S-25)', async ({
    alice,
  }) => {
    const { page } = alice;
    await page.setViewportSize({ width: 375, height: 740 });
    await expect(page.getByRole('button', { name: FIELD })).toBeHidden();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = await palette(page).boundingBox();
    expect(box?.width).toBe(375);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
  });
});
