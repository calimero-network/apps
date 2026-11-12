import { AppError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { MeroPixartClient, type AppTransport } from "../generated/client";

/**
 * The document contract is called through `MeroPixartClient`
 * (`src/generated/client.ts`, which `mero-app-build codegen` writes from
 * `logic/res/abi.json`): camelCase method and argument names, `u64`/`i64`
 * arguments as decimal strings (`i64` below), views as views.
 *
 * Answers need no translation: every integer the contract answers is inside a
 * record the contract keeps as v1 did (JSON numbers, camelCase fields). The ABI
 * names those records without their shapes, so the generated types are
 * `unknown` and the screens cast them to `types/`.
 *
 * `pixartTransport` is the one adapter on the wire: a refusal reaches the
 * screens as an `Error` with v1's words (`messageOf`), which is also what
 * `rpcWithFallback` (api/compat) reads a missing method from.
 * `client.test.ts` checks the generated class against the committed ABI.
 */

/** The package production instances come from. */
export const PACKAGE = "com.calimero.mero-pixart";

/** A clock or coordinate as the contract takes a `u64`/`i64`: a whole decimal string. */
export function i64(n: number): string {
  return String(Math.trunc(n));
}

/** {@link i64}, keeping "not given". */
export function optI64(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : i64(n);
}

/** Rethrows a refusal as an `Error` with v1's words, the original as its `cause`. */
function rethrow(err: unknown): never {
  throw Object.assign(new Error(messageOf(err)), { cause: err });
}

/** `client` with every refusal in v1's words ({@link messageOf}), for `MeroPixartClient` to call through. */
export function pixartTransport(client: AppTransport): AppTransport {
  return {
    apps: {
      call: (args, options) => client.apps.call(args, options).catch(rethrow),
      view: (args, options) => client.apps.view(args, options).catch(rethrow),
    },
    events: (app, from, signal) => client.events(app, from, signal),
  };
}

/** The document `app` through `client`; `after` runs after every request. */
export function pixartClient(client: AppTransport, app: string, after?: () => void): MeroPixartClient {
  return new MeroPixartClient(pixartTransport(client), app, after ? { after } : {});
}

export { MeroPixartClient };

/** One line for the UI, in v1's words where v1 had them. */
export function messageOf(error: unknown): string {
  const e = error as { appCode?: unknown; fields?: Record<string, unknown> } | null;
  if (error instanceof AppError || typeof e?.appCode === "string") {
    const code = String(e?.appCode);
    const fields = e?.fields ?? {};
    switch (code) {
      case "ViewOnly":
        return "view-only: editor or admin access is required to modify this document";
      case "OwnerOnly":
        return "only the document owner can do that";
      case "Invalid":
        return String(fields.message ?? "invalid input");
      // `rpcWithFallback` (api/compat) reads this as a missing method.
      case "UnknownMethod":
        return "method not found";
      default:
        return describeError(error);
    }
  }
  return describeError(error);
}
