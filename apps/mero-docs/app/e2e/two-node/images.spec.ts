// An image an Editor adds reaches another member: the block syncs through the
// document, and the bytes come from the uploader's node through the folder.

import { expect, test } from '../fixtures/two-user';
import { pngFile } from '../fixtures/images';

test('an image Alice adds shows for Bob', async ({ alice, bob }) => {
  await alice.goToWorkspace();
  await alice.createNamespace('Images Setup');
  await alice.createFolder({ name: 'Shared', visibility: 'Open' });
  await alice.tree.openFolder('Shared');
  await alice.createDoc('Board');
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await alice.closeSettings();

  await bob.joinNamespace(inviteUrl);
  await bob.tree.openFolder('Shared');
  await bob.restrictedCard.joinIfPrompted('Shared');
  await bob.docs.expectDocVisible('Board');

  await alice.openDoc('Board');
  await alice.editor.type('Plan');
  await alice.page.keyboard.press('Enter');
  await alice.editor.addImages([pngFile('plan.png')]);
  await expect(alice.editor.image('plan.png')).toBeVisible();

  await bob.openDoc('Board');
  const image = bob.editor.image('plan.png');
  await expect(image).toBeVisible({ timeout: 90_000 });
  await expect(image).toHaveJSProperty('naturalWidth', 160);
});
