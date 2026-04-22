// Subscribe to SSE events on a docs context and invoke `onChange`
// whenever any event arrives. Phase 8's DocumentEditor uses this to
// invalidate its doc list / content without polling.
//
// `useSubscription` from mero-react takes the context-id list and a
// callback directly, handles the connection lifecycle internally,
// and replays no state itself — we just forward the signal to the
// caller's invalidation trigger.

import { useCallback } from 'react';
import { useSubscription, type SseEventData } from '@calimero-network/mero-react';

export function useDocEvents(
  docsContextId: string | null,
  onChange: () => void,
): void {
  const handler = useCallback(
    (_event: SseEventData) => {
      onChange();
    },
    [onChange],
  );
  // useSubscription accepts a string[]; [] disables the subscription.
  useSubscription(docsContextId ? [docsContextId] : [], handler);
}
