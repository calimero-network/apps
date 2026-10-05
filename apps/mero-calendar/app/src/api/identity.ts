/**
 * Who this session writes as — the ACCOUNT, not a signing key.
 *
 * ⚠️ The distinction this module exists for:
 *
 *   - `getContextIdentity()` (mero-react) holds the context SIGNING KEY, taken
 *     from `getContextIdentitiesOwned`. It is what a node signs deltas with.
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
 * Where the account comes from: `admin.getNodeIdentity().accountId`, through
 * the SESSION-AWARE admin (`useMero().admin`). On a node that is the node's
 * account. On a delegated session the account admin answers with the signed-in
 * account itself — where the raw `GET {relay}/admin-api/identity` this replaced
 * returned the RELAY's identity, so an account owned nothing it had written.
 */
import type { AdminApiClient } from "@calimero-network/mero-js";

let cached = "";

/**
 * The session's account id, or "" when it could not be read.
 *
 * Cached for the life of the page: an account does not change under a running
 * session, and the ownership check runs on every event render.
 */
export function accountId(): string {
  return cached;
}

/**
 * Resolve the account id once, before anything compares against it.
 *
 * Returns "" rather than throwing when the read is unavailable: an unknown
 * account must degrade to "own nothing" (no Edit, no Delete), never to "own
 * everything". The contract is the real gate either way — `update_event` and
 * `delete_event` both bail with `Forbidden` for a non-owner — so the worst a
 * failure here can do is hide a button, not authorize a write.
 */
export async function loadAccountId(
  admin: Pick<AdminApiClient, "getNodeIdentity"> | null | undefined,
): Promise<string> {
  if (cached) return cached;
  if (!admin) return "";
  try {
    const res = (await admin.getNodeIdentity()) as {
      accountId?: string;
      account_id?: string;
    };
    cached = (res?.accountId ?? res?.account_id ?? "").trim();
  } catch {
    cached = "";
  }
  return cached;
}

/** Test seam — drops the cache so a spec can set up a different session. */
export function resetAccountId(): void {
  cached = "";
}
