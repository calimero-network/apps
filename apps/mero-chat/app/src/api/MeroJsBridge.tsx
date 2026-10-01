import { type ReactNode } from "react";
import { useMero } from "@calimero-network/mero-react";
import { setMeroJs } from "./meroJsClient";

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
  const { mero } = useMero();
  setMeroJs(mero);
  return <>{children}</>;
}
