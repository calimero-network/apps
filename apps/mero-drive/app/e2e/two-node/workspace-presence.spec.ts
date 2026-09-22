// Presence rides ephemeral slices on the registry context, never the DAG.

import { test } from '../fixtures/two-user';

test.describe('Workspace presence (two-node)', () => {
  test("Bob shows as here in Alice's members panel, then away once he leaves", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Presence WS');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();

    await bob.joinNamespace(inviteUrl);
    await alice.settings.expectMemberPresence('bob', 'Here now');
    await alice.settings.expectMemberPresence('alice', 'Here now');

    await bob.page.close();
    await alice.settings.expectMemberPresence('bob', 'Away');
  });
});
