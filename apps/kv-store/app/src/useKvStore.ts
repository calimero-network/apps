import { useMemo } from "react";
import { useMero } from "@calimero-network/mero-react";
import { KvStoreClient } from "./generated/KvStoreClient";

/**
 * The generated client, bound to this session.
 *
 * Everything the UI calls goes through `KvStoreClient`, which is generated from
 * `logic/res/abi.json` and regenerated + diffed in CI. That is the point: a
 * method the contract does not export is not a runtime 500, it is a name that
 * does not exist on this object and `tsc -b` says so.
 *
 * One caveat, so nobody over-trusts it — the generated types are only as good
 * as the ABI, and the ABI loses `Option<T>`. `get(key) -> Option<String>` in
 * Rust arrives as `"kind": "string"` and generates `Promise<string>`, so a
 * missing key is typed as `string` and is actually `null`. Method names and
 * argument names are trustworthy; nullability is not — and that one needs fixing
 * in core's ABI emitter, which drops the `Option` before codegen ever sees it.
 */
export function useKvStore(contextId: string): KvStoreClient | null {
  const { mero, contextIdentity } = useMero();

  return useMemo(() => {
    if (!mero) return null;
    // The third argument is `executorPublicKey`, which mero-js marks
    // `@deprecated  No longer used by the server. Ignored if provided.` — the
    // node derives the caller from the bearer token. The generated constructor
    // still requires it, so pass what the session has and expect it to be
    // ignored.
    return new KvStoreClient(mero, contextId, contextIdentity ?? "");
  }, [mero, contextId, contextIdentity]);
}
