// The docs list's subscription to its own folder's docs context. Strict:
// useSubscription hands every handler the events of every context the
// window subscribes to, and the node reports each one's sync status every
// two seconds, so a docs list that took them all would re-read on every
// other folder's tick. A docs list changes only through its own context.
//
// @deprecated Use `useContextEvents` directly. This alias is kept
// solely so the existing `useDocs` caller compiles without a rename
// cascade; remove in a follow-up once `useDocs` migrates.

import { useContextEvents } from './useContextEvents';

/** @deprecated Use {@link useContextEvents} instead. */
export function useDocEvents(
  docsContextId: string | null,
  onChange: () => void,
): void {
  useContextEvents(docsContextId, onChange, { strict: true });
}
