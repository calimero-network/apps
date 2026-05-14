// Folder tree propagation — tests 47-49. Verifies that nested
// folder creation, reparenting, and deletion all propagate from
// Alice's node to Bob's tree.

import { test, expect } from '../fixtures/two-user';

test.describe('Folder tree propagation (two-node)', () => {
  test.skip(
    'Nested folders created on Alice appear on Bob with same shape',
    async ({ alice, bob }) => {
      // Alice creates A → A/B → A/B/C; assert Bob's tree shows the
      // same nesting (expand-and-find via tree.openFolder).
    },
  );

  test.skip(
    'Reparenting A/B under root updates Bob\'s tree',
    async ({ alice, bob }) => {
      // Driver needs reparent action — placeholder until that
      // lands.
    },
  );

  test.skip(
    'Deleting A/B/C drops it from Bob\'s tree',
    async ({ alice, bob }) => {
      // Cascade scenario also covered by single-node test 15.
    },
  );
});
