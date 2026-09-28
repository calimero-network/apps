// The search palette: the top-bar field and Cmd/Ctrl+K, recent docs, title,
// folder and tag matches, matches inside doc text, and what it could not search.

import type { Route } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';

const TEXT_GROUP = 'In document text';
const SLOW_READ_MS = 5_000; // holds one doc read so the text search is caught mid-build

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
    const { page, palette } = alice;
    const field = palette.field();
    await field.click();
    await expect(palette.input()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette.dialog()).toBeHidden();
    await expect(field).toBeFocused();

    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette.input()).toBeFocused();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette.dialog()).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(palette.input()).toBeFocused();
  });

  test('lists recent docs newest first, then the tags tip (S-02)', async ({
    alice,
  }) => {
    const { palette } = alice;
    await alice.home.open();
    await alice.home.row('Roadmap 2026').click();
    await alice.editor.expectMounted();
    await alice.home.open();
    await alice.home.row('Q3 launch plan').click();
    await alice.editor.expectMounted();

    await palette.field().click();
    await expect(palette.group('Recent').getByRole('option')).toHaveText([
      /^Q3 launch planProduct · opened just now/,
      /^Roadmap 2026Product · opened just now/,
    ]);
    await expect(palette.group('Tips')).toContainText(
      'Type # to search tags only',
    );
  });

  test('ranks title matches, then folders, highlighting the match (S-04)', async ({
    alice,
  }) => {
    const { palette } = alice;
    await palette.search('road');
    const docs = palette.group('Documents').getByRole('option');
    await expect(docs).toHaveText([/^Roadmap 2026/]);
    await expect(docs.first().locator('mark')).toHaveText('Road');
    await expect(palette.group('Folders').getByRole('option')).toHaveText([
      'Roads',
    ]);
    await palette.search('zebra');
    await expect(
      palette.dialog().getByText('No documents, folders or tags match'),
    ).toBeVisible();
  });

  test('# searches tags only, and a tag opens Home filtered to it (S-09, S-11)', async ({
    alice,
  }) => {
    const { page, palette } = alice;
    await alice.openDoc('Roadmap 2026');
    await alice.tags.create('roadmap');
    await alice.editor.close();

    await palette.search('#');
    await expect(palette.dialog().getByRole('group')).toHaveCount(1);
    await expect(palette.group('Tags').getByRole('option')).toHaveText([
      '#roadmap1 document · show them all on Home',
    ]);
    await palette.search('#road');
    await expect(palette.group('Documents')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(palette.dialog()).toBeHidden();
    await expect(page).toHaveURL(/\/app\/[^/?]+\?(.*&)?tag=/);
    await alice.home.expectTitles(['Roadmap 2026']);
  });

  test('arrows wrap, Enter opens, Cmd/Ctrl+Enter opens a new tab (S-10)', async ({
    alice,
  }) => {
    const { page, palette } = alice;
    // "p": Q3 launch plan (word start), Roadmap 2026 (inside), then the Product folder.
    await palette.search('p');
    const active = palette.dialog().getByRole('option', { selected: true });
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
    await expect(palette.dialog()).toBeVisible();

    await page.keyboard.press('Enter');
    await alice.editor.expectMounted();
    await expect(page.getByTestId('doc-title-input')).toHaveValue(
      'Q3 launch plan',
    );
  });

  test('a folder result opens the folder list (S-12)', async ({ alice }) => {
    const { page, palette } = alice;
    await palette.search('roads');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/f\/[^/?#]+(\?.*)?$/);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Roads' }),
    ).toBeVisible();
  });

  test('finds body text under its heading and opens at the block (S-13)', async ({
    alice,
  }) => {
    const { page, palette } = alice;
    await alice.openDoc('Roadmap 2026');
    await alice.editor.type('# Versioning');
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'One breaking change per year, so v2 has to wait.',
    );
    await alice.editor.close();

    await palette.search('breaking change');
    const hit = palette.group(TEXT_GROUP).getByRole('option');
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
    const { page, palette } = alice;
    await page.route('**/jsonrpc', async (route) => {
      if (rpcCall(route)?.method === 'get_document') {
        await new Promise((resolve) => setTimeout(resolve, SLOW_READ_MS));
      }
      await route.continue();
    });
    await page.reload();
    await palette.search('road');
    await expect(palette.group('Documents').getByRole('option')).toHaveText([
      /^Roadmap 2026/,
    ]);
    await expect(
      palette.group(TEXT_GROUP).getByText(/\d of \d folders searched/),
    ).toBeVisible();
    await expect(palette.dialog().getByText(/folders searched/)).toBeHidden({
      timeout: 60_000,
    });
  });

  test('names a folder it could not read instead of skipping it (S-17)', async ({
    alice,
  }) => {
    const { page, palette } = alice;
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
    await palette.search('road');
    const warning = palette
      .dialog()
      .getByText(/^Finance (could not be searched|is still syncing)/);
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).not.toContainText('Product');
  });

  test('fits a 375 px screen as an icon and a full-width sheet (S-25)', async ({
    alice,
  }) => {
    const { page, palette } = alice;
    await alice.openDoc('Roadmap 2026');
    await alice.tags.create('q3');
    await alice.tags.create('roadmap-2026');
    await alice.tags.create('launch');
    await alice.editor.close();

    await page.setViewportSize({ width: 375, height: 740 });
    await expect(palette.field()).toBeHidden();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = await palette.dialog().boundingBox();
    expect(box?.width).toBe(375);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);

    // The folder keeps its whole name; the tags and time move down a line.
    await palette.search('road');
    const folder = palette
      .group('Documents')
      .getByRole('option', { name: /Roadmap 2026/ })
      .getByText('Product', { exact: true });
    await expect(folder).toBeVisible();
    expect(
      await folder.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBe(0);
  });
});
