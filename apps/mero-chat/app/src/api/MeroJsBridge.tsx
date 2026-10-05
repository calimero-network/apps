import { type ReactNode } from "react";
import { NoRelayError, useMero } from "@calimero-network/mero-react";
import { type ChatClient, setMeroJs } from "./meroJsClient";
import { setResolvedApplicationId } from "../constants/config";

/**
 * Hands MeroProvider's client to the non-React callers in `api/` (dataSource
 * modules, blob helpers, identity utils) via a module-level holder.
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
 * This is also the app's ONE `session.kind` switch. mero-react already decided
 * what the session is: `admin` is the node's own admin client on a node login
 * and the account admin on an account (relay reads, delegated writes,
 * `NotForAccountError` for node-only methods), `mero.rpc` is the node's
 * JSON-RPC or the relay's query/intents transport, and `applicationId` is the
 * registry-derived id of chat's package on an account. Everything below the
 * bridge reads those and never a node URL, a token or an `/admin-api/` route.
 *
 * Registered during render (not in an effect) so children can reach it in their
 * own mount effects. The assignment is idempotent, so StrictMode's double render
 * is harmless.
 */
export default function MeroJsBridge({ children }: { children: ReactNode }) {
  const { mero, admin, isDelegated, applicationId } = useMero();
  // An account runs chat under the id the registry derives for its package;
  // a node keeps resolving it from the URL / stored / build-time value.
  const sessionApplicationId = isDelegated ? applicationId : null;
  setResolvedApplicationId(sessionApplicationId);
  setMeroJs(
    admin
      ? {
          admin,
          // An account that has joined nothing yet has an admin and no relay to
          // run a contract on: it has no context to call either.
          rpc: mero
            ? (mero as unknown as { rpc: ChatClient["rpc"] }).rpc
            : { execute: () => Promise.reject(new NoRelayError("execute")) },
          isDelegated,
          applicationId: sessionApplicationId,
        }
      : null,
  );
  return <>{children}</>;
}
