// A peer's typing reaches an open page through reads of the typed block, not a
// re-read of the whole document per burst; only the idle reconcile still reads
// the whole document, so those reads stay rarer than the block reads.

import type { Page } from '@playwright/test';
import { expect, shareOpenDoc, SYNC_MS, test } from '../fixtures/two-user';
import { rpcMethod } from '../fixtures/rpc';

const BURSTS = ['alpha', ' beta', ' gamma', ' delta', ' epsilon'];

/** Counts the page's RPC calls by app method. */
function countCalls(page: Page): Map<string, number> {
  const calls = new Map<string, number>();
  page.on('request', (req) => {
    const method = rpcMethod(req);
    if (method) calls.set(method, (calls.get(method) ?? 0) + 1);
  });
  return calls;
}

test("a peer's typing is read block by block, not as the whole document", async ({
  alice,
  bob,
}) => {
  await shareOpenDoc(alice, bob, 'Peer reads WS');
  await alice.openDoc('Plan');
  await alice.editor.type('hi');
  await bob.openDoc('Plan');
  await bob.editor.expectContent('hi', { timeout: SYNC_MS });

  const calls = countCalls(bob.page);
  let typed = 'hi';
  for (const burst of BURSTS) {
    await alice.page.keyboard.type(burst);
    typed += burst;
    await bob.editor.expectContent(typed, { timeout: SYNC_MS });
  }
  const blockReads = calls.get('get_block') ?? 0;
  expect(blockReads).toBeGreaterThanOrEqual(BURSTS.length);
  expect(calls.get('get_document') ?? 0).toBeLessThan(blockReads);
});
