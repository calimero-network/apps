import { useMemo } from "react";
import { readDelegatedCredential, useMero } from "@calimero-network/mero-react";
import { myIdFor } from "../lib/identity";

/**
 * The id the contract records for THIS session — see `lib/identity`.
 *
 * `identity` is the executor the session holds in the room's context (what
 * `identities-owned` returned, stored by `setActiveRoom`). On a node that is the
 * answer. On an account it is the account, and the contract keys by the
 * certified device's signing key instead, which lives in the delegated
 * credential; this reads it there.
 */
export function useMyId(identity: string | null | undefined): string | null {
  const { isDelegated } = useMero();
  return useMemo(
    () =>
      myIdFor({
        isDelegated,
        credential: isDelegated
          ? (readDelegatedCredential()?.credential ?? null)
          : null,
        identity,
      }),
    [isDelegated, identity],
  );
}
