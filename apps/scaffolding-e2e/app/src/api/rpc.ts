// ── Calling the contract ─────────────────────────────────────────────────────
//
// Every section calls the contract through the functions in `kvStore.ts`, and
// reads back the envelope it displays (`{ result: { output } }` or `{ error }`).
// Those functions call `ScaffoldingE2eClient` (`src/generated/client.ts`, which
// `mero-app-build codegen` writes from `logic/res/abi.json`) with the ABI's
// method and argument names; this file is what sits around it:
//
//   • `contract()` is the class over the open instance's signed-in client;
//   • `run` turns one call into the envelope: a typed contract error
//     (`AppError`: `appCode` + `fields`) is folded into `envelope.error`
//     instead of thrown, because the sections show it;
//   • 64-bit integers travel as decimal strings: `u64` makes an argument one,
//     and `int` turns a `u64`/`i64` result back into a number.

import { describeError } from "@calimero-apps/connect";

import { getConnection } from "../lib/calimero";
import { ScaffoldingE2eClient } from "../generated/client";

/**
 * What a section displays: the value, or the error. `ResultBox` colours a
 * response red by looking for the `error` key.
 */
export interface RpcEnvelope<T = unknown> {
  result?: { output?: T };
  error?: unknown;
}

/** Thrown for an unusable local state (not signed in, no instance open). */
export class RpcCallError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "RpcCallError";
  }
}

/** `uploadedAt` → `uploaded_at`. */
export function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** A 64-bit integer argument as the decimal string the contract takes. */
export function u64(n: number | string): string {
  return typeof n === "number" ? String(Math.trunc(n)) : n;
}

/** A `u64`/`i64` result (a decimal string on the wire) as a number. */
export function int(value: unknown): unknown {
  return typeof value === "string" ? Number(value) : value;
}

/** The error as the sections show it: the contract's code and fields, and a readable line. */
function errorEnvelope(e: unknown): RpcEnvelope["error"] {
  const err = e as { appCode?: string; fields?: unknown; code?: string; status?: number };
  return {
    ...(err.appCode ? { code: err.appCode } : err.code ? { code: err.code } : {}),
    ...(err.fields !== undefined ? { fields: err.fields } : {}),
    ...(typeof err.status === "number" ? { status: err.status } : {}),
    message: describeError(e),
  };
}

/**
 * The contract of the open instance. Throws when nobody is signed in or no
 * instance is open; `method` names the call that wanted it.
 */
export function contract(method = "contract"): ScaffoldingE2eClient {
  const conn = getConnection();
  if (!conn) {
    throw new RpcCallError("No app instance open — sign in and pick one in the Setup Wizard first.", method);
  }
  return new ScaffoldingE2eClient(conn.client, conn.appId, { after: conn.after });
}

/**
 * Run one contract method (`call`, on the open instance's class) and return
 * the envelope, its answer through `answer` (`int`, `v1Record`, …). A contract
 * failure comes back as `envelope.error`; only a missing session or instance
 * throws.
 */
export async function run<T = unknown>(
  method: string,
  call: (contract: ScaffoldingE2eClient) => Promise<unknown>,
  answer: (value: unknown) => unknown = (value) => value,
): Promise<RpcEnvelope<T>> {
  const c = contract(method);
  try {
    return { result: { output: answer(await call(c)) as T } };
  } catch (e) {
    return { error: errorEnvelope(e) };
  }
}
