// What a workspace member sees across restricted and nested folders: every
// surface that lists, counts, searches or links docs agrees with the folder tree.

import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';
import { escapeRegex, type WorkspaceDriver } from '../fixtures/workspace';

const TEST_MS = 600_000; // two full sweeps over two nodes
const SYNC_MS = 60_000; // one sync round between nodes, with room
const TAG = 'matrix'; // on every doc, so its counts say which docs a member can read
const TITLE_WORD = 'plan'; // in every doc title, so one search lists every readable doc
const TEXT_WORD = 'quokka'; // only in the linked doc's text
const VIEW = 'Scoped docs'; // the shared view, filtered to one folder
const TEXT_GROUP = 'In document text';
const NO_MATCH = 'No documents, folders or tags match';

interface Doc {
  title: string;
  folder: string;
  path: string;
}

// `linked` links to `visible` and back; Bob can always read `visible`.
interface Pair {
  visible: Doc;
  linked: Doc;
}

interface Sight {
  folders: string[]; // tree rows, each parent before its children
  docs: Record<string, string>; // every doc Bob can read: title -> folder
  folderOptions: Record<string, number>; // Home's Folder filter: label -> count
  view: string[]; // titles the shared view shows
  readable: boolean; // whether Bob can open the linked doc
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function startsWith(text: string): RegExp {
  return new RegExp(`^${escapeRegex(text)}`);
}

async function expectTexts(list: Locator, texts: string[]): Promise<void> {
  await expect
    .poll(
      async () => (await list.allInnerTexts()).map((t) => t.trim()).sort(),
      {
        timeout: SYNC_MS,
      },
    )
    .toEqual([...texts].sort());
}

// Expands each folder in turn, so a nested folder's row is on screen.
async function expand(driver: WorkspaceDriver, names: string[]): Promise<void> {
  for (const name of names) {
    await driver.tree.expectFolderVisible(name, { timeout: SYNC_MS });
    await driver.tree.expandFolder(name);
  }
}

// ─── Alice's side ────────────────────────────────────────────────

async function startWorkspace(alice: WorkspaceDriver, name: string) {
  await alice.goToWorkspace();
  await alice.createNamespace(`${name} ${Date.now()}`);
}

async function inviteBob(alice: WorkspaceDriver, bob: WorkspaceDriver) {
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await alice.closeSettings();
  await bob.joinNamespace(inviteUrl);
  // Bob's node has synced the workspace, so Alice's member picker can name him.
  await expect(bob.home.navRow()).toBeVisible({ timeout: SYNC_MS });
}

async function setBobMember(
  alice: WorkspaceDriver,
  folder: string,
  member: boolean,
) {
  await alice.openFolderInfo(folder);
  if (member) {
    await alice.sharing.addMember('bob');
    await alice.sharing.expectMemberVisible('bob');
  } else {
    await alice.sharing.removeMember('bob');
  }
  await alice.closeFolderInfo();
}

async function writeTaggedDoc(
  alice: WorkspaceDriver,
  folder: string,
  title: string,
) {
  await alice.tree.openFolder(folder);
  await alice.createDoc(title);
  await alice.openDoc(title);
  await alice.tags.add(TAG);
  await alice.editor.close();
}

// Both docs carry TAG; `linked` holds TEXT_WORD and a link to `visible`, which links back.
async function writePair(
  alice: WorkspaceDriver,
  visible: Omit<Doc, 'path'>,
  linked: Omit<Doc, 'path'>,
): Promise<Pair> {
  const { page, editor } = alice;
  await alice.tree.openFolder(visible.folder);
  await alice.createDoc(visible.title);
  await alice.openDoc(visible.title);
  await alice.tags.create(TAG);
  const visibleUrl = page.url();
  await editor.close();

  await alice.tree.openFolder(linked.folder);
  await alice.createDoc(linked.title);
  await alice.openDoc(linked.title);
  await editor.type(`${TEXT_WORD} figures. See `);
  await editor.pasteLink(visibleUrl, visible.title);
  await alice.tags.add(TAG);
  // Links to reads the node, so the link is saved before the reload drops the page.
  await alice.details.open();
  await expect(
    alice.details
      .section('Links to')
      .getByRole('button', { name: new RegExp(escapeRegex(visible.title)) }),
  ).toBeVisible({ timeout: SYNC_MS });
  const linkedUrl = page.url();

  await page.goto(visibleUrl);
  await editor.expectMounted();
  await editor.type('Details live in ');
  await editor.linkDoc(
    linked.title.split(' ')[0].toLowerCase(),
    new RegExp(escapeRegex(linked.title)),
  );
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  return {
    visible: { ...visible, path: new URL(visibleUrl).pathname },
    linked: { ...linked, path: new URL(linkedUrl).pathname },
  };
}

async function shareFolderView(alice: WorkspaceDriver, folder: string) {
  const { page, home } = alice;
  await home.open();
  await home.chip('Folder').click();
  await page
    .getByRole('checkbox', {
      name: new RegExp(`^${escapeRegex(folder)}\\s*\\d+$`),
    })
    .click();
  await page.keyboard.press('Escape');
  await home.saveViewButton().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(VIEW);
  await page.getByRole('radio', { name: /Everyone in/ }).click();
  await page.locator('form').getByRole('button', { name: 'Save view' }).click();
  await expect(home.viewRow(VIEW)).toBeVisible();
}

// ─── Bob's side: one check per surface ───────────────────────────

async function expectView(bob: WorkspaceDriver, sight: Sight) {
  const { page, home } = bob;
  const row = home.viewRow(VIEW);
  await expect(row).toHaveAccessibleName(
    `${VIEW}, shared with everyone, ${sight.view.length}`,
    { timeout: SYNC_MS },
  );
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'page');
  const n = sight.view.length;
  await expect(
    page
      .getByRole('main')
      .getByText(`${plural(n, 'document')} ${n === 1 ? 'matches' : 'match'}`),
  ).toBeVisible();
  await expectTexts(
    page.getByRole('main').getByTestId('doc-title'),
    sight.view,
  );
}

async function expectHome(bob: WorkspaceDriver, pair: Pair, sight: Sight) {
  const { page, home } = bob;
  const titles = Object.keys(sight.docs);
  const folders = new Set(Object.values(sight.docs)).size;
  const main = page.getByRole('main');
  await home.open();
  await expect(home.navRow()).toHaveAccessibleName(`Home, ${titles.length}`, {
    timeout: SYNC_MS,
  });
  await expect(
    main.getByText(
      `${plural(titles.length, 'document')} across ${plural(folders, 'folder')}`,
    ),
  ).toBeVisible({ timeout: SYNC_MS });
  await expectTexts(main.getByTestId('doc-title'), titles);
  if (!sight.readable) {
    await expect(main).not.toContainText(pair.linked.title);
    await expect(main).not.toContainText(pair.linked.folder);
  }
}

async function expectFolderFilter(bob: WorkspaceDriver, sight: Sight) {
  const { page, home } = bob;
  await home.chip('Folder').click();
  const popover = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('textbox', { name: 'Filter folders' }) });
  const options = popover.getByRole('checkbox');
  const expected = Object.entries(sight.folderOptions);
  await expect(options).toHaveCount(expected.length, { timeout: SYNC_MS });
  for (const [label, count] of expected) {
    await expect(
      options.filter({
        hasText: new RegExp(`^${escapeRegex(label)}\\s*${count}$`),
      }),
    ).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
}

async function expectTag(bob: WorkspaceDriver, sight: Sight) {
  const { page, home } = bob;
  const titles = Object.keys(sight.docs);
  const folders = new Set(Object.values(sight.docs)).size;
  await expect(home.tagRow(TAG)).toHaveAccessibleName(
    `${TAG}, ${titles.length}`,
    { timeout: SYNC_MS },
  );
  await home.tagRow(TAG).click();
  await expect(home.heading()).toHaveText(TAG);
  await expect(
    page
      .getByRole('main')
      .getByText(
        `${plural(titles.length, 'document')} in ${plural(folders, 'folder')}`,
      ),
  ).toBeVisible({ timeout: SYNC_MS });
  await expectTexts(page.getByRole('main').getByTestId('doc-title'), titles);
}

async function expectTree(bob: WorkspaceDriver, pair: Pair, sight: Sight) {
  await expand(bob, sight.folders);
  await expectTexts(bob.tree.folderRows(), sight.folders);
  for (const title of Object.keys(sight.docs)) {
    await bob.docs.expectDocVisible(title, { timeout: SYNC_MS });
  }
  if (!sight.readable) {
    await expect(bob.docs.docRow(pair.linked.title)).toHaveCount(0);
  }
}

async function expectSearch(bob: WorkspaceDriver, pair: Pair, sight: Sight) {
  const { palette, page } = bob;
  const { linked } = pair;
  const titles = Object.keys(sight.docs);

  await palette.search(TITLE_WORD);
  const docs = palette.group('Documents').getByRole('option');
  await expect(docs).toHaveCount(titles.length, { timeout: SYNC_MS });
  for (const title of titles) {
    await expect(docs.filter({ hasText: startsWith(title) })).toHaveCount(1);
  }
  await expect(palette.dialog().getByText(/folders searched/)).toBeHidden({
    timeout: SYNC_MS,
  });

  await palette.search(linked.folder);
  const folderHit = palette
    .group('Folders')
    .getByRole('option', { name: startsWith(linked.folder) });
  if (sight.readable) {
    await expect(folderHit).toBeVisible();
  } else {
    await expect(palette.dialog().getByText(NO_MATCH)).toBeVisible();
    await expect(palette.dialog()).not.toContainText(linked.folder);
  }

  await palette.search(TEXT_WORD);
  if (sight.readable) {
    await expect(
      palette.group(TEXT_GROUP).getByRole('option', {
        name: startsWith(linked.title),
      }),
    ).toBeVisible({ timeout: SYNC_MS });
  } else {
    await expect(palette.dialog().getByText(NO_MATCH)).toBeVisible();
  }

  await palette.search(`#${TAG}`);
  await expect(palette.group('Tags').getByRole('option')).toContainText(
    `${plural(titles.length, 'document')} · show them all on Home`,
  );
  await page.keyboard.press('Escape');
  await expect(palette.dialog()).toBeHidden();
}

async function expectLinks(bob: WorkspaceDriver, pair: Pair, sight: Sight) {
  const { page, editor, details } = bob;
  const { visible, linked } = pair;
  await page.goto(visible.path);
  await editor.expectMounted({ timeout: SYNC_MS });
  await expect(page.getByTestId('doc-title-input')).toHaveValue(visible.title, {
    timeout: 15_000,
  });

  await details.open();
  const from = details.section('Linked from');
  if (sight.readable) {
    await expect(
      from.getByRole('button', { name: new RegExp(escapeRegex(linked.title)) }),
    ).toBeVisible({ timeout: SYNC_MS });
  } else {
    await expect(from).toContainText('No documents link here yet', {
      timeout: SYNC_MS,
    });
    await expect(details.panel()).not.toContainText(linked.title);
  }

  const link = editor.docLink(linked.title);
  await expect(link).toBeVisible({ timeout: SYNC_MS });
  await link.hover();
  if (sight.readable) {
    await expect(editor.linkCard()).toContainText(linked.title, {
      timeout: 30_000,
    });
  } else {
    await expect(editor.linkCard()).toHaveText(
      'This is in a folder you cannot open',
      { timeout: 30_000 },
    );
  }
}

function noAccessCard(bob: WorkspaceDriver, doc: Doc): Locator {
  return bob.page.getByText(`This document is in ${doc.folder}`);
}

async function expectDeepLink(
  bob: WorkspaceDriver,
  doc: Doc,
  readable: boolean,
) {
  const { page, editor } = bob;
  await page.goto(doc.path);
  if (readable) {
    await editor.expectMounted({ timeout: SYNC_MS });
    await expect(page.getByTestId('doc-title-input')).toHaveValue(doc.title, {
      timeout: 15_000,
    });
  } else {
    await expect(noAccessCard(bob, doc)).toBeVisible({ timeout: SYNC_MS });
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
  }
}

// Ends on the linked doc's own link, so a sweep of a readable doc leaves it open.
async function expectSight(bob: WorkspaceDriver, pair: Pair, sight: Sight) {
  await expectView(bob, sight);
  await expectHome(bob, pair, sight);
  await expectFolderFilter(bob, sight);
  await expectTag(bob, sight);
  await expectTree(bob, pair, sight);
  await expectSearch(bob, pair, sight);
  await expectLinks(bob, pair, sight);
  await expectDeepLink(bob, pair.linked, sight.readable);
}

// Losing access swaps the open editor for the card live: no reload, nothing thrown.
async function expectOpenDocRevoked(
  bob: WorkspaceDriver,
  doc: Doc,
  revoke: () => Promise<void>,
) {
  const { page } = bob;
  await bob.editor.expectMounted();
  const thrown: Error[] = [];
  page.on('pageerror', (e) => thrown.push(e));
  await page.evaluate(() => {
    (window as { sameLoad?: boolean }).sameLoad = true;
  });

  await revoke();

  await expect(noAccessCard(bob, doc)).toBeVisible({ timeout: SYNC_MS });
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(doc.path);
  expect(
    await page.evaluate(() => (window as { sameLoad?: boolean }).sameLoad),
  ).toBe(true);
  expect(thrown).toEqual([]);
}

test.describe('Visibility matrix (two-node)', () => {
  test.describe.configure({ timeout: TEST_MS });

  test('a restricted child under an open parent hides only the child', async ({
    alice,
    bob,
  }) => {
    await startWorkspace(alice, 'Matrix Child');
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.createFolder({
      name: 'Payroll',
      visibility: 'Restricted',
      parent: 'Product',
    });
    const pair = await writePair(
      alice,
      { title: 'Plan', folder: 'Product' },
      { title: 'Salary plan', folder: 'Payroll' },
    );
    await shareFolderView(alice, 'Product');
    await inviteBob(alice, bob);

    await expectSight(bob, pair, {
      folders: ['Product'],
      docs: { Plan: 'Product' },
      folderOptions: { Product: 1 },
      view: ['Plan'],
      readable: false,
    });

    await expand(alice, ['Product']);
    await setBobMember(alice, 'Payroll', true);

    await expectSight(bob, pair, {
      folders: ['Product', 'Payroll'],
      docs: { Plan: 'Product', 'Salary plan': 'Payroll' },
      folderOptions: { Product: 2, 'Product / Payroll': 1 },
      view: ['Plan', 'Salary plan'],
      readable: true,
    });
  });

  // Reports is Open, but core's inheritance walk stops at Finance, a Restricted
  // folder Bob is not in, so Reports is as hidden from him as Finance.
  test('an open child under a restricted parent stays hidden', async ({
    alice,
    bob,
  }) => {
    await startWorkspace(alice, 'Matrix Wall');
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.createFolder({
      name: 'Reports',
      visibility: 'Open',
      parent: 'Finance',
    });
    await alice.createFolder({ name: 'Lobby', visibility: 'Open' });
    const pair = await writePair(
      alice,
      { title: 'Plan', folder: 'Lobby' },
      { title: 'Audit plan', folder: 'Reports' },
    );
    await shareFolderView(alice, 'Finance');
    await inviteBob(alice, bob);

    await expectSight(bob, pair, {
      folders: ['Lobby'],
      docs: { Plan: 'Lobby' },
      folderOptions: { Lobby: 1 },
      view: [],
      readable: false,
    });
  });

  // A folder whose parent Bob cannot see sits at the top of his tree, and no
  // path, filter or result names the parent.
  test('a member of a restricted child only sees the child at the top level', async ({
    alice,
    bob,
  }) => {
    await startWorkspace(alice, 'Matrix Orphan');
    await alice.createFolder({ name: 'Leadership', visibility: 'Restricted' });
    await alice.createFolder({
      name: 'Hiring',
      visibility: 'Restricted',
      parent: 'Leadership',
    });
    const pair = await writePair(
      alice,
      { title: 'Hiring plan', folder: 'Hiring' },
      { title: 'Offsite plan', folder: 'Leadership' },
    );
    // Filtered to the parent, the view still counts the child's docs for Bob.
    await shareFolderView(alice, 'Leadership');
    await inviteBob(alice, bob);
    await expand(alice, ['Leadership']);
    await setBobMember(alice, 'Hiring', true);

    await expectSight(bob, pair, {
      folders: ['Hiring'],
      docs: { 'Hiring plan': 'Hiring' },
      folderOptions: { Hiring: 1 },
      view: ['Hiring plan'],
      readable: false,
    });
  });

  test('removal from a restricted folder closes its open doc live', async ({
    alice,
    bob,
  }) => {
    await startWorkspace(alice, 'Matrix Removal');
    await alice.createFolder({ name: 'Lobby', visibility: 'Open' });
    await alice.createFolder({ name: 'Legal', visibility: 'Restricted' });
    const pair = await writePair(
      alice,
      { title: 'Plan', folder: 'Lobby' },
      { title: 'Contract plan', folder: 'Legal' },
    );
    await shareFolderView(alice, 'Legal');
    await inviteBob(alice, bob);
    await setBobMember(alice, 'Legal', true);

    await expectSight(bob, pair, {
      folders: ['Lobby', 'Legal'],
      docs: { Plan: 'Lobby', 'Contract plan': 'Legal' },
      folderOptions: { Lobby: 1, Legal: 1 },
      view: ['Contract plan'],
      readable: true,
    });

    await expectOpenDocRevoked(bob, pair.linked, () =>
      setBobMember(alice, 'Legal', false),
    );

    await expectSight(bob, pair, {
      folders: ['Lobby'],
      docs: { Plan: 'Lobby' },
      folderOptions: { Lobby: 1 },
      view: [],
      readable: false,
    });
  });

  // Restricting the parent walls off its Open child too: inheritance into
  // Specs ran through Engineering, which Bob is not an explicit member of.
  test('restricting an open parent hides its open child as well', async ({
    alice,
    bob,
  }) => {
    await startWorkspace(alice, 'Matrix Flip');
    await alice.createFolder({ name: 'Lobby', visibility: 'Open' });
    await alice.createFolder({ name: 'Engineering', visibility: 'Open' });
    await alice.createFolder({
      name: 'Specs',
      visibility: 'Open',
      parent: 'Engineering',
    });
    const pair = await writePair(
      alice,
      { title: 'Plan', folder: 'Lobby' },
      { title: 'API plan', folder: 'Specs' },
    );
    await writeTaggedDoc(alice, 'Engineering', 'Roadmap plan');
    await shareFolderView(alice, 'Engineering');
    await inviteBob(alice, bob);

    await expectSight(bob, pair, {
      folders: ['Lobby', 'Engineering', 'Specs'],
      docs: {
        Plan: 'Lobby',
        'Roadmap plan': 'Engineering',
        'API plan': 'Specs',
      },
      folderOptions: { Lobby: 1, Engineering: 2, 'Engineering / Specs': 1 },
      view: ['Roadmap plan', 'API plan'],
      readable: true,
    });

    await expectOpenDocRevoked(bob, pair.linked, () =>
      alice.toggleVisibility('Engineering'),
    );

    await expectSight(bob, pair, {
      folders: ['Lobby'],
      docs: { Plan: 'Lobby' },
      folderOptions: { Lobby: 1 },
      view: [],
      readable: false,
    });
  });
});
