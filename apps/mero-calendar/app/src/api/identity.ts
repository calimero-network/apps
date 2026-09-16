/**
 * Who this node writes as — the ACCOUNT, not a signing key.
 *
 * ⚠️ The distinction this module exists for:
 *
 *   - `getContextIdentity()` (mero-react) holds the context SIGNING KEY, taken
 *     from `/contexts/{id}/identities-owned`. It is what the node signs deltas
 *     with.
 *   - `env::account_id()` — what the contract stores in `CalendarEvent.owner`
 *     and what `listGroupMembers` rows are keyed by — is the ACCOUNT.
 *
 * Since core 0.11.0-rc.27 removed base58, BOTH are 64 hex characters. Nothing
 * on the client or the server objects when one is passed where the other is
 * meant: it simply names a principal that exists nowhere. Comparing the signing
 * key to `event.owner` therefore does not throw and does not warn — it is just
 * silently false for every event, including your own, which is what made the
 * calendar hide Edit and Delete from the people who owned the events.
 *
 * mero-js says the same thing in the doc comment on `getMemberCapabilities`:
 * member-addressing endpoints take the account, "both are 32-byte strings, so
 * passing a key names nobody and raises nothing".
 */
import { adminGet } from "./rpc";

/** Shape of `GET /admin-api/identity` (core's `NodeIdentity`). */
interface NodeIdentityResponse {
  accountId?: string;
  account_id?: string;
  publicKey?: string;
}

let cached = "";

/**
 * The node's account id, or "" when it could not be read.
 *
 * Cached for the life of the page: a node's account does not change under a
 * running session, and the ownership check runs on every event render.
 */
export function accountId(): string {
  return cached;
}

/**
 * Resolve the account id once, before anything compares against it.
 *
 * Returns "" rather than throwing when the route is unavailable: an unknown
 * account must degrade to "own nothing" (no Edit, no Delete), never to "own
 * everything". The contract is the real gate either way — `update_event` and
 * `delete_event` both bail with `Forbidden` for a non-owner — so the worst a
 * failure here can do is hide a button, not authorize a write.
 */
export async function loadAccountId(): Promise<string> {
  if (cached) return cached;
  try {
    const res = await adminGet<NodeIdentityResponse>("/identity");
    cached = (res?.accountId ?? res?.account_id ?? "").trim();
  } catch {
    cached = "";
  }
  return cached;
}

/** Test seam — drops the cache so a spec can set up a different node. */
export function resetAccountId(): void {
  cached = "";
}
