import { type ReactNode } from "react";
import { NoRelayError, useMero } from "@calimero-network/mero-react";
import { type ChatClient, setMeroJs } from "./meroJsClient";

/**
 * Hands MeroProvider's MeroJs instance to the non-React callers in `api/`
 * (dataSource modules, blob helpers) via a module-level holder.
 *
 * Curb used to `new MeroJs(...)` a SECOND instance of its own alongside the one
 * MeroProvider creates internally. Both pointed at the same `mero-tokens` blob,
 * but mero-js's refresh single-flight (`refreshTokenPromise`) is per-INSTANCE —
 * so two instances meant two independent mutexes over one token bundle. With
 * single-use refresh tokens (core#3083) a concurrent refresh is fatal: whichever
 * instance loses the race re-presents an already-consumed refresh token, the
 * server reads that as theft (401 `x-auth-error: token_reuse`) and revokes the
 * whole token family — logging out every holder. One instance, one mutex.
 *
 * Registered during render (not in an effect) so children can reach it in their
 * own mount effects. The assignment is idempotent, so StrictMode's double render
 * is harmless.
 */
export default function MeroJsBridge({ children }: { children: ReactNode }) {
  // `admin` is the node's own admin client on a node and the account admin on
  // an account (mero-react), so the data sources need no second code path.
  const { mero, admin } = useMero();
  setMeroJs(
    admin
      ? {
          admin,
          // An account that has joined nothing yet has an admin and no relay to
          // run a contract on: it has no context to call either.
          rpc: mero
            ? (mero as unknown as { rpc: ChatClient["rpc"] }).rpc
            : { execute: () => Promise.reject(new NoRelayError("execute")) },
        }
      : null,
  );
  return <>{children}</>;
}
