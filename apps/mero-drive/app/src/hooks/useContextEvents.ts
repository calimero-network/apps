// Subscribe to merod SSE events for one or more contexts and invoke
// `onChange` whenever any event arrives. Drives live-refresh across
// the app surface (workspace switcher, folder tree, members panels,
// doc body, etc.) without polling.
//
// `useSubscription` from mero-react opens one EventSource per
// distinct contextId set, internally keyed on `JSON.stringify`, and
// fans events to all handlers. Multiple components subscribing to
// the same id set share a single connection — the dedupe happens at
// that layer, so this hook does not memoise the array itself; it
// just normalises and sorts the input so a re-render with the same
// content produces the same stringified key.
//
// Handler stability: pass a stable `onChange` (wrapped in
// `useCallback`) — mero-react reads the callback via ref so a fresh
// arrow each render does NOT disconnect the SSE socket, but the
// caller should still keep handler identity stable so the
// per-subscriber bookkeeping doesn't churn.

import { useCallback } from 'react';
import {
  useSubscription,
  type SseEventData,
} from '@calimero-network/mero-react';

export function useContextEvents(
  contextIds:
    | ReadonlyArray<string | null | undefined>
    | string
    | null
    | undefined,
  onChange: () => void,
): void {
  // Normalise + sort the id set inline. Computing on every render is
  // cheap (≤ a handful of strings) and lets mero-react's
  // JSON.stringify dedupe inside useSubscription do its job without
  // a redundant local memo layer.
  const ids: string[] = [];
  if (typeof contextIds === 'string') {
    if (contextIds.length > 0) ids.push(contextIds);
  } else if (Array.isArray(contextIds)) {
    for (const c of contextIds) {
      if (typeof c === 'string' && c.length > 0) ids.push(c);
    }
  }
  ids.sort();

  const handler = useCallback(
    (_event: SseEventData) => {
      onChange();
    },
    [onChange],
  );

  useSubscription(ids, handler);
}
