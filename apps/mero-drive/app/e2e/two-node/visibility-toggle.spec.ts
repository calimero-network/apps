// Visibility toggle propagation — tests 33-36 from the catalog.
//
// Test 36 is the wire-shape regression guard: intercept the
// set_subgroup_visibility request and assert the payload is
// lowercase. This is the exact bug we shipped silently before
// (`useFolderOperations.ts:163` / `FolderVisibilityToggle.tsx:44`).

import { test, expect } from '../fixtures/two-user';

test.describe('Visibility toggle (two-node)', () => {
  test.skip(
    'Open → Restricted revokes Bob\'s inherited access',
    async ({ alice, bob }) => {
      // Setup: Alice creates Open folder; Bob joins and materializes.
      // Then Alice flips to Restricted. Expected: Bob's view
      // collapses back to the ask-admin card.
    },
  );

  test.skip(
    'Restricted → Open lets Bob inherit and join',
    async ({ alice, bob }) => {
      // Inverse of the above: ask-admin → Join CTA → folder visible.
    },
  );

  test('set_subgroup_visibility wire payload is lowercase', async ({
    alice,
  }) => {
    // Wire-shape regression guard. Intercept the admin-api call
    // and assert the payload's `subgroupVisibility` is lowercase —
    // core returns 400 on capitalized values.
    await alice.goToWorkspace();
    await alice.createNamespace(`Wire WS ${Date.now()}`);
    await alice.createFolder({ name: 'WireFolder', visibility: 'Open' });

    let payload: Record<string, unknown> | null = null;
    await alice.page.route(
      '**/admin-api/groups/*/visibility',
      async (route) => {
        const body = route.request().postData();
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch {
            /* let server respond — assertion below will fail with
             * the raw body. */
          }
        }
        await route.continue();
      },
    );

    await alice.toggleVisibility('WireFolder');

    expect(payload).not.toBeNull();
    expect(typeof payload!.subgroupVisibility).toBe('string');
    expect(payload!.subgroupVisibility).toMatch(/^(open|restricted)$/);
  });
});
