// A Guest watching an open doc sees the owner's changes without reloading.
//
// Guest is core ReadOnly on the workspace, so its node replicates the registry
// read-only; the tag colour lives there, the typed text in the folder's context.

import { test, expect } from '../fixtures/two-user';

const RED = 'rgb(239, 68, 68)';
const LIVE_MS = 20_000; // well under the 30s heartbeat that repairs a stale replica

test.describe('Guest live view (two-node)', () => {
  test("a Guest's open doc follows the owner's typing and tagging", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Guest Live WS ${Date.now()}`);
    await alice.createFolder({ name: 'Room', visibility: 'Restricted' });
    await alice.tree.openFolder('Room');
    await alice.createDoc('Live');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await bob.joinNamespace(inviteUrl);
    await alice.settings.setMemberRole('bob', 'Guest');
    await alice.closeSettings();

    await alice.openFolderInfo('Room');
    await alice.sharing.addMember('bob');
    await alice.sharing.expectMemberVisible('bob');
    await alice.closeFolderInfo();

    await bob.tree.expectFolderVisible('Room', { timeout: 60_000 });
    await bob.tree.openFolder('Room');
    await bob.restrictedCard.joinIfPrompted('Room');
    await bob.openDoc('Live');
    await bob.editor.expectMounted();

    await alice.openDoc('Live');
    await alice.editor.type('typed while the guest watches');
    await bob.editor.expectContent('typed while the guest watches', {
      timeout: LIVE_MS,
    });

    await alice.tags.create('seen', 'Red');
    await expect
      .poll(() => bob.tags.dotColour('seen'), { timeout: LIVE_MS })
      .toBe(RED);
  });
});
