// Tells a write the node never got (retry, keep the edit) from one the node
// answered and refused (today's stale-and-reread behavior). Checked against
// mero-js's typed errors, never a message string.

import { UnavailableError } from '@calimero-network/mero-js';

/** True for a failure the node never got to answer, or a cluster briefly
 *  unable to serve (503); false for one it answered. */
export function isTransportFailure(cause: unknown): boolean {
  return cause instanceof UnavailableError || cause instanceof TypeError;
}
