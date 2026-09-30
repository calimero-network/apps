// A folder's Read only member, as the sharing panel sets it: core ReadOnly in
// the folder's group, so the node discards their writes. Bob reaches the Open
// folder by inheritance only, so the panel has to add a direct row for him.

import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures/two-user';
import { getEnv } from '../fixtures/env';
import type { WorkspaceDriver } from '../fixtures/workspace';
import { parseAppPath } from '../../src/lib/routes';

const SYNC_MS = 60_000; // a write or a role change crossing to the other node

async function shareOpenDoc(
  alice: WorkspaceDriver,
  bob: WorkspaceDriver,
  ws: string,
) {
  await alice.goToWorkspace();
  await alice.createNamespace(ws);
  await alice.createFolder({ name: 'Team', visibility: 'Open' });
  await alice.tree.openFolder('Team');
  await alice.createDoc('Plan');
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await alice.closeSettings();

  await bob.joinNamespace(inviteUrl);
  await bob.tree.expectFolderVisible('Team', { timeout: SYNC_MS });
  await bob.tree.openFolder('Team');
  await bob.restrictedCard.joinIfPrompted('Team');
  await bob.docs.expectDocVisible('Plan', { timeout: SYNC_MS });
}

async function setBobsRole(alice: WorkspaceDriver, role: string) {
  await alice.openFolderInfo('Team');
  await alice.sharing.setMemberRole('bob', role);
  await alice.closeFolderInfo();
}

// Answers `route` from the node, with every `key: from` in the reply swapped for `to`.
async function rewrite(route: Route, key: string, from: string, to: string) {
  const res = await route.fetch();
  const json: unknown = JSON.parse(await res.text(), (k, v) =>
    k === key && v === from ? to : v,
  );
  await route.fulfill({ response: res, json });
}

// Bob's permission reads keep saying Editor, as on a page that missed the change.
async function keepBobAnEditor(page: Page) {
  await page.route('**/admin-api/groups/*/members', (route) =>
    rewrite(route, 'role', 'ReadOnly', 'Member'),
  );
  await page.route('**/jsonrpc', (route) => {
    const call = route.request().postDataJSON() as {
      params?: { method?: string };
    } | null;
    return call?.params?.method === 'get_folder_role'
      ? rewrite(route, 'output', 'Viewer', 'Editor')
      : route.continue();
  });
}

// Bob's own core role in the folder his page shows, as his node reports it.
async function bobsCoreRole(page: Page): Promise<string | null> {
  const folder = parseAppPath(new URL(page.url()).pathname, '')?.folder;
  const node = getEnv({ twoNode: true }).node2!;
  const get = async (path: string) => {
    const res = await fetch(`${node.url}${path}`, {
      headers: { Authorization: `Bearer ${node.accessToken}` },
    });
    return (await res.json()) as {
      accountId?: string;
      data?: { accountId?: string };
      members?: { identity: string; role: string }[];
    };
  };
  // mero-js unwraps an optional `data` envelope; so does this.
  const identity = await get('/admin-api/identity');
  const account = (identity.data ?? identity).accountId;
  const { members } = await get(`/admin-api/groups/${folder}/members`);
  return members?.find((m) => m.identity === account)?.role ?? null;
}

test.describe('Folder Read only (two-node)', () => {
  test('a Read only member gets no write affordances while an Editor edits live', async ({
    alice,
    bob,
  }) => {
    await shareOpenDoc(alice, bob, 'Read only WS');
    await setBobsRole(alice, 'Read only');
    // Core, not the registry row, is what refuses his writes.
    await expect
      .poll(() => bobsCoreRole(bob.page), { timeout: SYNC_MS })
      .toBe('ReadOnly');

    await bob.openDoc('Plan');
    await expect(bob.page.getByTestId('doc-title-input')).toHaveCount(0, {
      timeout: SYNC_MS,
    });
    await expect(bob.page.locator('.ProseMirror').first()).toHaveAttribute(
      'contenteditable',
      'false',
    );
    await expect(
      bob.page.getByRole('button', { name: 'Document actions' }),
    ).toHaveCount(0);
    await expect(bob.page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(bob.tags.row()).toHaveCount(0);

    await alice.openDoc('Plan');
    await alice.editor.type('live from alice');
    await bob.editor.expectContent('live from alice', { timeout: SYNC_MS });

    await setBobsRole(alice, 'Editor');
    await expect
      .poll(() => bobsCoreRole(bob.page), { timeout: SYNC_MS })
      .toBe('Member');
    await expect(bob.page.getByTestId('doc-title-input')).toBeVisible({
      timeout: SYNC_MS,
    });
    await bob.editor.type(' and bob');
    await alice.editor.expectContent('live from alice and bob', {
      timeout: SYNC_MS,
    });
  });

  test('a stale page that still offers an edit shows the node truth, not the discarded write', async ({
    alice,
    bob,
  }) => {
    await shareOpenDoc(alice, bob, 'Stale role WS');
    await alice.openDoc('Plan');
    await alice.editor.type('before');
    await bob.openDoc('Plan');
    await bob.editor.expectContent('before', { timeout: SYNC_MS });

    await keepBobAnEditor(bob.page);
    await setBobsRole(alice, 'Read only');
    await expect
      .poll(() => bobsCoreRole(bob.page), { timeout: SYNC_MS })
      .toBe('ReadOnly');

    await expect(bob.page.getByTestId('doc-title-input')).toBeVisible();
    // A new block would go through insert_block, whose discarded result the
    // editor resends without end; this test is about text, so stay on the line.
    await bob.page.locator('.ProseMirror').first().getByText('before').click();
    await bob.page.keyboard.press('End');
    await bob.page.keyboard.type(' phantom');
    await expect(bob.page.locator('.ProseMirror').first()).not.toContainText(
      'phantom',
      { timeout: 30_000 },
    );
    // Alice's next edit reaching Bob shows her node has taken everything he sent.
    await alice.editor.type(' after');
    await bob.editor.expectContent('before after', { timeout: SYNC_MS });
    await expect(alice.page.locator('.ProseMirror').first()).not.toContainText(
      'phantom',
    );
  });
});
