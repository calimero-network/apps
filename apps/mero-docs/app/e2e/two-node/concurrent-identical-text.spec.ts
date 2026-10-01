// A peer's letter lands at the front of a block of identical letters while the
// user's own keystroke is still on its way. The peer's edit is read off the
// node's character ids, so the keystroke keeps its place where a text diff would
// take the peer's letter for one appended at the end.

import type { Page } from '@playwright/test';
import { expect, shareOpenDoc, SYNC_MS, test } from '../fixtures/two-user';
import { rpcMethod } from '../fixtures/rpc';

const HELD = new Set(['apply_delta_on', 'get_block', 'get_document']);

// Parks the page's body reads and writes at the network until the returned release runs.
async function holdBody(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/jsonrpc', async (route) => {
    if (HELD.has(rpcMethod(route.request()) ?? '')) await gate;
    await route.continue();
  });
  return release;
}

function body(page: Page) {
  return page.locator('.ProseMirror').first();
}

// Puts the caret `from` characters after the start of the line.
async function caretAt(page: Page, from: number) {
  await body(page).getByText(/^\w+$/).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < from; i++) await page.keyboard.press('ArrowRight');
}

test('a peer letter ahead of identical ones does not move the keystroke in flight', async ({
  alice,
  bob,
}) => {
  await shareOpenDoc(alice, bob, 'Identical text WS');
  await alice.openDoc('Plan');
  await alice.editor.type('aa');
  await bob.openDoc('Plan');
  await bob.editor.expectContent('aa', { timeout: SYNC_MS });

  // A second page on Alice's node shows what it holds, which her held page cannot.
  const node = await alice.page.context().newPage();
  await node.goto(alice.page.url());
  await expect(body(node)).toHaveText('aa', { timeout: SYNC_MS });

  const release = await holdBody(alice.page);
  await caretAt(alice.page, 1);
  await alice.page.keyboard.type('X');
  await expect(body(alice.page)).toHaveText('aXa');

  // Bob puts a letter ahead of the two. Typed straight in, it would be sent as
  // an append, so it goes in as a stand-in letter that a replacement swaps.
  await caretAt(bob.page, 0);
  await bob.page.keyboard.type('Q');
  await expect(body(node)).toHaveText('Qaa', { timeout: SYNC_MS });
  await bob.page.keyboard.press('Shift+ArrowLeft');
  await bob.page.keyboard.type('a');
  await expect(body(node)).toHaveText('aaa', { timeout: SYNC_MS });
  await node.close();

  release();
  await expect(body(alice.page)).toHaveText('aaXa', { timeout: SYNC_MS });
  await expect(body(bob.page)).toHaveText('aaXa', { timeout: SYNC_MS });

  // A reload reads each node's own copy.
  await alice.page.reload();
  await bob.page.reload();
  await expect(body(alice.page)).toHaveText('aaXa', { timeout: SYNC_MS });
  await expect(body(bob.page)).toHaveText('aaXa', { timeout: SYNC_MS });
});
