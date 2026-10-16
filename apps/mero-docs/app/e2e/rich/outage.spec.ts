// An edit typed as the window's node goes down lands once the node is back,
// even when the folder tree is read again while the node cannot answer. A
// read that got no answer once emptied the tree, which closed the document
// and dropped the edit it had not sent yet.

import { expect, test } from './fixtures/rich';
import { blockText } from './helpers/doc-model';
import { caretTo, caretToEnd } from './helpers/editor';
import { switchNode, waitForHealth } from './helpers/rig';
import { blocksOnNode, type DocRef } from './helpers/rpc';

const KEY_DELAY_MS = 300; // slow enough that the node stops mid-word

async function firstBlockOnNode1(doc: DocRef): Promise<string> {
  const [first] = await blocksOnNode(1, doc);
  return first ? blockText(first) : '';
}

test('an edit made as the node goes down survives a folder re-read', async ({
  rig,
}) => {
  test.setTimeout(10 * 60_000);
  const [a] = await rig.seed([1, 2]);
  await caretTo(a.page, 0, 0);
  await a.page.keyboard.type('Seed.');
  await expect
    .poll(() => firstBlockOnNode1(rig.doc), { timeout: 60_000 })
    .toBe('Seed.');

  await caretToEnd(a.page, 0);
  const restart = switchNode(1, 'offline');
  await a.page.keyboard.type(' kept', { delay: KEY_DELAY_MS });
  await waitForHealth(1, false);
  // The app reads the folder tree again on focus; this one gets no answer.
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await restart;

  await expect
    .poll(() => firstBlockOnNode1(rig.doc), { timeout: 90_000 })
    .toBe('Seed. kept');
});
