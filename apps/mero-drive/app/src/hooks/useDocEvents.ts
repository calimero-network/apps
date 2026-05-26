// Thin alias for backwards-compat with the original docs-only
// subscription helper. New call sites should import
// `useContextEvents` directly from `./useContextEvents`.
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
  useContextEvents(docsContextId, onChange);
}
