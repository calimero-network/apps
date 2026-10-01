// Tells a node the write just can't reach (retry, keep the edit) from a node
// that answered and refused it (today's stale-and-reread behavior). Checked
// against mero-js's real error shapes, never a message string.

import { HTTPError } from '@calimero-network/mero-js';

// HTTPError(0, 'Network Error', ...) is what web-client.js's catch-all wraps
// every raw fetch failure into: a thrown TypeError, an AbortError timeout, a
// refused connection. 502/503/504 are a reachable node briefly unable to serve.
const TRANSPORT_HTTP_STATUSES = new Set([0, 502, 503, 504]);

/** True for a failure the node never got to answer; false for one it did. */
export function isTransportFailure(cause: unknown): boolean {
  return cause instanceof HTTPError && TRANSPORT_HTTP_STATUSES.has(cause.status);
}
