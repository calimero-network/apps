// Typing that a node acknowledges stays typed when that node restarts right
// after. collab-session's "apart" step once lost the last keystrokes of
// ' Left side.' this way: both windows and every node ended with ' Left si'.
// One typist, on node 1, so nothing but the restart can take the text away.

import { expect, test } from './fixtures/rich';
import { settle } from './helpers/converge';
import { blockText, occurrences } from './helpers/doc-model';
import { caretToEnd } from './helpers/editor';
import { switchNode } from './helpers/rig';
import { blocksOnNode } from './helpers/rpc';

const NODES = [1, 2];
const KEY_DELAY_MS = 90; // as collab-session types, so the last flush is close behind the last key
const ROUNDS = 5; // the loss showed once in several runs of one step

test('typing right before a node restarts is kept, on every node and in the window', async ({
  rig,
}) => {
  test.setTimeout(15 * 60_000);
  const [a] = await rig.seed(NODES);

  for (let round = 1; round <= ROUNDS; round++) {
    const run = ` Restart ${round} kept.`;
    await test.step(`round ${round}: type, then restart node 1 at once`, async () => {
      await switchNode(1, 'offline');
      await caretToEnd(a.page, 0);
      await a.page.keyboard.type(run, { delay: KEY_DELAY_MS });
      // No wait for "saved": the restart lands while the last keystrokes are
      // still on their way, which is the window the lost text fell into.
      await switchNode(1, 'online');

      await settle(rig.doc, NODES);
      for (const node of NODES) {
        await expect
          .poll(
            async () => occurrences(blockText((await blocksOnNode(node, rig.doc))[0]), run),
            { message: `round ${round}: node ${node} holds the run once`, timeout: 60_000 },
          )
          .toBe(1);
      }
      await expect
        .poll(
          async () =>
            occurrences(
              await a.page.getByTestId('doc-editor').locator('.bn-inline-content').first().innerText(),
              run,
            ),
          { message: `round ${round}: the window still shows the run`, timeout: 30_000 },
        )
        .toBe(1);
    });
  }
});
