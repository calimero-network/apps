// Display-name gate — new coverage for the PR1 blocking overlay.
//
// After creating OR joining a namespace, a blocking overlay appears
// whenever the member has no display name. It is role="dialog"
// aria-labelledby="name-gate-title", heading "Set your name", an
// input placeholder="Your display name", and a "Continue" button.
// It overlays the sidebar + main (z-40) but NOT the top bar —
// the namespace <select>, Settings, and Log out stay accessible.

import { test, expect } from '../fixtures/single-user';

test.describe('Display-name gate (single-node)', () => {
  test('gate blocks until a name is set', async ({ alice }) => {
    await alice.goToWorkspace();
    // createNamespaceKeepGate performs the create steps but does NOT
    // dismiss the gate — leaves it visible for assertion.
    await alice.createNamespaceKeepGate(`Gate WS ${Date.now()}`);

    // Gate is present.
    await expect(
      alice.page.getByRole('dialog', { name: /Set your name/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Top-bar escape hatches remain accessible despite the overlay.
    await expect(alice.page.locator('select').first()).toBeVisible();
    await expect(
      alice.page.getByRole('button', { name: /Log out/i }),
    ).toBeEnabled();

    // Fill the name and continue.
    const gate = alice.page.getByRole('dialog', { name: /Set your name/i });
    await gate.getByPlaceholder('Your display name').fill('Gate Test User');
    await gate.getByRole('button', { name: /^Continue$/ }).click();

    // Gate dismissed; sidebar/main now accessible — "Select a folder" shows.
    await expect(gate).toBeHidden({ timeout: 20_000 });
    await expect(
      alice.page.getByRole('heading', { name: /Select a folder/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('no gate when a name is already set', async ({ alice }) => {
    await alice.goToWorkspace();
    // createNamespace auto-dismisses the gate.
    await alice.createNamespace(`No Gate WS ${Date.now()}`);

    // Gate must not reappear now that the name is set.
    await expect(
      alice.page.getByRole('dialog', { name: /Set your name/i }),
    ).toBeHidden({ timeout: 5_000 });
  });
});
