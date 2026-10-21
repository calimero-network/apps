import { getNodeUrl, useMero } from "@calimero-network/mero-react";

/**
 * What there is to list from, as a key that changes whenever the session does,
 * so a load keyed on it re-runs for the session that is actually live.
 *
 * Null until mero-react has a client (`admin`). An account signs in through a
 * relay and stores no node URL, and is ready only once chat's registry-derived
 * application id has landed too: listing before it filters the account's
 * namespaces by the node fallback id and finds none. A node is keyed by its URL.
 *
 * A key, not a boolean: a `mero:node_url` left from an earlier node login reads
 * as ready before the account session exists, and a gate that is already true
 * never fires again when the session changes underneath it.
 */
export function useSessionKey(): string | null {
  const { admin, isDelegated, applicationId } = useMero();
  if (!admin) return null;
  if (isDelegated) return applicationId ? `account:${applicationId}` : null;
  const nodeUrl = getNodeUrl();
  return nodeUrl ? `node:${nodeUrl}` : null;
}
