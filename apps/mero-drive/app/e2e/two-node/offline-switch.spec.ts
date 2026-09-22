// The rig's offline switch, end to end: a write made while node 2 is down
// cannot reach Bob, and reaches him verbatim once his node is back.
//
// The switch is the dev server's bridge to scripts/local-rig.sh, so this spec
// also covers the endpoint the dev panel drives.

import { existsSync } from 'node:fs';
import { expect, test } from '../fixtures/two-user';

// Written by `scripts/local-rig.sh up`; without it the /__dev switch has no rig to drive.
const RIG_ENV = new URL('../../.env.integration', import.meta.url);
const BEFORE = 'alpha-before';
const AFTER = 'beta-after';
const CONVERGED = `${BEFORE} ${AFTER}`;
// Long enough that a working sync would have delivered it: Bob saw BEFORE well
// inside this window.
const OFFLINE_HOLD_MS = 20_000;
// Same surface EditorDriver waits for; the negative assertion needs its own
// locator, so keep the one spelling here.
const EDITOR = '.ProseMirror';

async function switchNode(
  page: import('@playwright/test').Page,
  index: number,
  action: 'offline' | 'online',
): Promise<void> {
  const resp = await page.request.post(`/__dev/node/${index}/${action}`);
  expect(resp.status(), await resp.text()).toBe(200);
  expect((await resp.json()).ok).toBe(true);
}

test.skip(!existsSync(RIG_ENV), 'the offline switch needs the local rig (scripts/local-rig.sh up)');

test.describe('Rig offline switch (two-node)', () => {
  // Restore without asserting: a test that failed mid-way must not also leave
  // node 2 down for the next spec.
  test.afterEach(async ({ alice }) => {
    await alice.page.request.post('/__dev/node/2/online');
  });

  test('a write made while node 2 is offline lands only after it returns', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Offline Switch');
    await alice.createFolder({ name: 'Pad', visibility: 'Open' });
    await alice.tree.openFolder('Pad');
    await alice.createDoc('Switch');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Pad');
    await bob.restrictedCard.joinIfPrompted();
    await bob.openDoc('Switch');

    // Baseline: the pipe works before anything is cut.
    await alice.openDoc('Switch');
    await alice.editor.type(BEFORE);
    await bob.editor.expectContent(BEFORE, { timeout: 60_000 });

    await switchNode(alice.page, 2, 'offline');

    const editor = alice.page.locator(EDITOR).first();
    await editor.click();
    await alice.page.keyboard.press('End');
    await editor.pressSequentially(` ${AFTER}`);
    await alice.editor.expectContent(CONVERGED);

    const bobEditor = bob.page.locator(EDITOR).first();
    await expect(bobEditor).not.toContainText(AFTER);
    await bob.page.waitForTimeout(OFFLINE_HOLD_MS);
    await expect(bobEditor).not.toContainText(AFTER);
    await expect(bobEditor).toContainText(BEFORE);

    await switchNode(alice.page, 2, 'online');

    // The node kept its home across the restart, but the page's event stream
    // did not survive it.
    await bob.page.reload();
    await bob.tree.openFolder('Pad');
    await bob.openDoc('Switch');
    await bob.editor.expectContent(CONVERGED, { timeout: 180_000 });
  });
});
