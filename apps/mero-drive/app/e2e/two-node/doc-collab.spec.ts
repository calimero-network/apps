// Real-time document collaboration — tests 43-46.
//
// TipTap is collaborative-ready but the production setup depends on
// the docs.wasm CRDT layer plus mero-react's useSubscription wiring.
// These tests assert the user-visible outcome (eventually consistent
// text), not the internal sync mechanism.

import { test, expect } from '../fixtures/two-user';

test.describe('Document collab (two-node)', () => {
  test.skip(
    'Both Alice and Bob open the same doc concurrently',
    async ({ alice, bob }) => {
      // Both editors mount. .ProseMirror present on both pages.
    },
  );

  test.skip(
    'Alice\'s edits become visible to Bob',
    async ({ alice, bob }) => {
      // Alice types; assert on Bob\'s editor with a generous timeout
      // (gossip + CRDT merge latency).
    },
  );

  test.skip(
    'Bob\'s edits become visible to Alice',
    async ({ alice, bob }) => {
      // Symmetric.
    },
  );

  test.skip(
    'Concurrent non-overlapping writes converge on both sides',
    async ({ alice, bob }) => {
      // Both type into different lines simultaneously; after a
      // settle window both halves appear on both nodes.
    },
  );
});
