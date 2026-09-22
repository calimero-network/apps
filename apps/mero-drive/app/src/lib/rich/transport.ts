// Tells a node the write just can't reach (retry, keep the edit) from a node
// that answered and refused it (today's stale-and-reread behavior). Checked
// against mero-js's real error shapes, never a message string.

import { HTTPError, RpcError } from '@calimero-network/mero-react';

// HTTPError(0, 'Network Error', ...) is what web-client.js's catch-all wraps
// every raw fetch failure into: a thrown TypeError, an AbortError timeout, a
// refused connection. 502/503/504 are a reachable node briefly unable to serve.
const TRANSPORT_HTTP_STATUSES = new Set([0, 502, 503, 504]);

/** True for a failure the node never got to answer; false for one it did. */
export function isTransportFailure(cause: unknown): boolean {
  if (cause instanceof HTTPError) return TRANSPORT_HTTP_STATUSES.has(cause.status);
  if (cause instanceof RpcError) return false;
  // Defensive fallback for a raw fetch failure that reached the caller
  // un-normalized (e.g. a test double, or a future client that skips the
  // HTTPError wrap): the same two real shapes browsers/undici actually throw.
  if (cause instanceof TypeError) return true;
  if (cause instanceof DOMException && cause.name === 'AbortError') return true;
  return false;
}
